// Reproducible exporter lifecycle checks. The encoder below is a test double:
// these tests verify scheduling/container metadata, not actual video playback.
// Run: node tests/video-export-test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { exportGrowthVideo, checkVideoSupport } from '../video-export.mjs';

const originalEncoder = globalThis.VideoEncoder;
const originalFrame = globalThis.VideoFrame;
const originalSetTimeout = globalThis.setTimeout;
const width = 1280, height = 720;
const canvas = () => ({ width, height });

function installEncoder(t, options = {}) {
  const stats = { frames: [], encoders: [], supportChecks: [], maximumQueue: 0, closedFrames: 0, closedEncoders: 0 };
  class MockFrame {
    constructor(source, init) {
      Object.assign(this, init);
      this.source = source;
      this.closed = false;
      stats.frames.push(this);
    }
    close() { assert.equal(this.closed, false, 'each frame is closed exactly once'); this.closed = true; stats.closedFrames++; }
  }
  class MockEncoder extends EventTarget {
    static async isConfigSupported(config) {
      stats.supportChecks.push(config);
      if (options.supportHangs) return new Promise(() => {});
      return { supported: options.supported !== false && (!options.onlyCodec || options.onlyCodec === config.codec), config };
    }
    constructor(callbacks) {
      super();
      this.callbacks = callbacks;
      this.state = 'unconfigured';
      this.encodeQueueSize = 0;
      this.work = [];
      stats.encoders.push(this);
    }
    configure(config) { this.config = config; this.state = 'configured'; }
    encode(frame, optionsForFrame) {
      assert.equal(frame.closed, false);
      this.encodeQueueSize++;
      stats.maximumQueue = Math.max(stats.maximumQueue, this.encodeQueueSize);
      if (options.queueHangs) return;
      this.work.push(new Promise(resolve => originalSetTimeout(() => {
        this.encodeQueueSize--;
        if (this.state !== 'closed') {
          if (options.encoderError) this.callbacks.error(new Error('Injected encoder failure'));
          else if (!options.dropOutput) {
            const metadata = options.noDecoderConfiguration ? {} : { decoderConfig: {
              codec: this.config.codec,
              description: new Uint8Array([1, 100, 0, 40, 255, 225, 0, 0])
            } };
            this.callbacks.output({
              timestamp: frame.timestamp,
              type: optionsForFrame.keyFrame ? 'key' : 'delta',
              duration: null, // Some browsers omit this; the exporter's schedule must win.
              byteLength: 4,
              copyTo(data) { data.set([0, 0, 0, 1]); }
            }, metadata);
          }
        }
        this.dispatchEvent(new Event('dequeue'));
        resolve();
      }, 2)));
    }
    async flush() {
      await Promise.all(this.work);
      if (options.flushHangs) await new Promise(() => {});
    }
    close() { assert.notEqual(this.state, 'closed'); this.state = 'closed'; stats.closedEncoders++; }
  }
  globalThis.VideoEncoder = MockEncoder;
  globalThis.VideoFrame = MockFrame;
  t.after(() => {
    globalThis.VideoEncoder = originalEncoder;
    globalThis.VideoFrame = originalFrame;
    globalThis.setTimeout = originalSetTimeout;
  });
  return stats;
}

function readBox(bytes, wanted, start = 0, end = bytes.byteLength) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  for (let offset = start; offset + 8 <= end;) {
    const length = view.getUint32(offset);
    assert(length >= 8 && offset + length <= end, 'MP4 box stays within its container');
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    if (type === wanted) return { offset, start: offset + 8, end: offset + length };
    offset += length;
  }
  assert.fail(`Missing MP4 box: ${wanted}`);
}

test('missing WebCodecs returns actionable support information', async t => {
  installEncoder(t);
  globalThis.VideoEncoder = undefined;
  const support = await checkVideoSupport({ width, height });
  assert.equal(support.supported, false);
  assert.match(support.reason, /Chrome or Edge/);
  assert.match(support.reason, /PNG and SVG/);
});

test('capability detection tries supported H.264 profiles and the exact requested size', async t => {
  const stats = installEncoder(t, { onlyCodec: 'avc1.4d0028' });
  const support = await checkVideoSupport({ width, height, fps: 30 });
  assert.equal(support.supported, true);
  assert.equal(support.config.codec, 'avc1.4d0028');
  assert(stats.supportChecks.length > 1);
  assert(stats.supportChecks.every(config => config.width === width && config.height === height && config.framerate === 30));
  assert.equal(support.config.avc.format, 'avc');
});

test('fixed timestamps include both visual endpoints and produce exact MP4 duration', async t => {
  const stats = installEncoder(t);
  const samples = [], events = [];
  const result = await exportGrowthVideo({
    width, height, duration: 0.2,
    renderFrame: async (timeline, seconds) => { samples.push([timeline, seconds]); return canvas(); },
    onProgress: event => events.push(event)
  });
  assert.deepEqual(samples[0], [0, 0]);
  assert.deepEqual(samples.at(-1), [1, 0.2]);
  assert.equal(result.frames, 6);
  assert.equal(result.duration, 0.2);
  assert.equal(result.mimeType, 'video/mp4');
  assert.equal(result.blob.type, 'video/mp4');
  assert.equal(result.extension, 'mp4');
  assert.equal(result.width, width);
  assert.equal(result.height, height);
  assert.equal(stats.closedFrames, result.frames);
  assert.equal(stats.closedEncoders, 1);
  assert(stats.maximumQueue <= 4);
  assert.deepEqual(stats.frames.map(frame => frame.timestamp), [0, 33333, 66667, 100000, 133333, 166667]);
  assert.equal(stats.frames.reduce((sum, frame) => sum + frame.duration, 0), 200000);
  assert.equal(events[0].phase, 'preparing');
  assert.equal(events.at(-1).phase, 'complete');
  assert.equal(events.at(-1).progress, 1);
  assert(events.every((event, index) => !index || event.progress >= events[index - 1].progress));

  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  const ftyp = readBox(bytes, 'ftyp');
  assert.equal(ftyp.offset, 0);
  const movie = readBox(bytes, 'moov');
  const header = readBox(bytes, 'mvhd', movie.start, movie.end);
  const view = new DataView(bytes.buffer);
  assert.equal(bytes[header.start], 0, 'this short video uses the version-zero movie header');
  const timescale = view.getUint32(header.start + 12);
  const durationTicks = view.getUint32(header.start + 16);
  assert.equal(durationTicks / timescale, 0.2);
});

test('a partial final frame retains the requested clip duration', async t => {
  const stats = installEncoder(t);
  const result = await exportGrowthVideo({ width, height, duration: 0.205, renderFrame: canvas });
  assert.equal(result.frames, 7);
  assert.equal(stats.frames.at(-1).timestamp, 200000);
  assert.equal(stats.frames.at(-1).duration, 5000);
  assert.equal(stats.frames.reduce((sum, frame) => sum + frame.duration, 0), 205000);
});

test('cancellation closes resources and never returns a partial download', async t => {
  const stats = installEncoder(t), controller = new AbortController();
  await assert.rejects(exportGrowthVideo({
    width, height, duration: 0.2, signal: controller.signal, renderFrame: canvas,
    onProgress: event => { if (event.frame === 2) controller.abort(); }
  }), { name: 'AbortError' });
  assert.equal(stats.closedFrames, stats.frames.length);
  assert.equal(stats.closedEncoders, 1);
});

test('cancellation interrupts a pending capability query', async t => {
  installEncoder(t, { supportHangs: true });
  const controller = new AbortController();
  const query = checkVideoSupport({ width, height, signal: controller.signal });
  controller.abort();
  await assert.rejects(query, { name: 'AbortError' });
});

test('invalid dimensions and unsupported encoders fail before rendering', async t => {
  const stats = installEncoder(t, { supported: false });
  assert.equal((await checkVideoSupport({ width: 1279, height })).supported, false);
  await assert.rejects(exportGrowthVideo({ width, height, duration: 0.2, renderFrame: canvas }), /H.264 export is unavailable/);
  assert.equal(stats.encoders.length, 0);
  await assert.rejects(exportGrowthVideo({ width, height, duration: Infinity, renderFrame: canvas }), /duration/);
});

test('mismatched canvas and renderer exceptions close the encoder', async t => {
  const stats = installEncoder(t);
  await assert.rejects(exportGrowthVideo({ width, height, duration: 0.2, renderFrame: () => ({ width: 1279, height }) }), /1280 × 720 canvas/);
  await assert.rejects(exportGrowthVideo({ width, height, duration: 0.2, renderFrame: () => { throw new Error('Injected render failure'); } }), /Injected render failure/);
  assert.equal(stats.closedEncoders, 2);
});

test('asynchronous encoder errors propagate and close all resources', async t => {
  const stats = installEncoder(t, { encoderError: true });
  await assert.rejects(exportGrowthVideo({ width, height, duration: 0.3, renderFrame: canvas }), /Injected encoder failure/);
  assert.equal(stats.closedFrames, stats.frames.length);
  assert.equal(stats.closedEncoders, 1);
});

for (const option of ['dropOutput', 'noDecoderConfiguration']) {
  test(`incomplete output (${option}) is rejected instead of downloading`, async t => {
    const stats = installEncoder(t, { [option]: true });
    await assert.rejects(exportGrowthVideo({ width, height, duration: 0.2, renderFrame: canvas }), /did not encode every video frame/);
    assert.equal(stats.closedEncoders, 1);
  });
}

for (const [option, expected, duration] of [
  ['queueHangs', /encoder stopped responding/, 0.3],
  ['flushHangs', /encoder could not finish/, 2 / 30]
]) {
  test(`${option} has a finite timeout and closes the encoder`, async t => {
    const stats = installEncoder(t, { [option]: true });
    // Accelerate only watchdogs. Frame work and normal task yielding remain real.
    globalThis.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, delay >= 8000 ? 10 : delay, ...args);
    await assert.rejects(exportGrowthVideo({ width, height, duration, renderFrame: canvas }), expected);
    assert.equal(stats.closedEncoders, 1);
    assert.equal(stats.closedFrames, stats.frames.length);
  });
}
