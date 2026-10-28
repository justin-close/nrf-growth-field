/**
 * Deterministic, silent H.264 / MP4 export. No playback clock or screen capture.
 *
 * renderFrame(t, seconds) must return a fully rendered canvas of the requested
 * dimensions. t includes both 0 and 1. The renderer owns and restores its state.
 * onProgress receives { phase, progress, frame, frames }, with progress in [0, 1].
 * Cancellation rejects with an AbortError; every other failure rejects with an
 * actionable Error. Nothing is downloaded until the caller receives the result.
 */

const MIME_TYPE = 'video/mp4';
const MAX_ENCODE_QUEUE = 4;
const CODECS = ['avc1.640034', 'avc1.640033', 'avc1.64002a', 'avc1.640028', 'avc1.4d0028'];
const BROWSER_HELP = 'Open this study in an up-to-date Chrome or Edge browser to export MP4. PNG and SVG exports are still available.';

function abortError() {
  return new DOMException('Video export canceled.', 'AbortError');
}

function dimensionsError(width, height, fps) {
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value % 2 === 0)) {
    return 'MP4 width and height must be positive, even whole numbers.';
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) {
    return 'MP4 frame rate must be a whole number between 1 and 120.';
  }
  return null;
}

// One failure channel covers encoder callbacks, cancellation and pending waits.
// Pending timers and listeners are removed as soon as an operation settles.
function createSession(signal) {
  let failure = null;
  const pending = new Set();
  const fail = error => {
    if (failure) return;
    failure = error instanceof Error || error instanceof DOMException ? error : new Error(String(error));
    for (const reject of [...pending]) reject(failure);
  };
  const onAbort = () => fail(abortError());
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();

  return {
    fail,
    check() { if (failure) throw failure; },
    wait(work, timeout, message) {
      return new Promise((resolve, reject) => {
        let timer;
        let settled = false;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          pending.delete(onFailure);
          if (error) reject(error); else resolve(value);
        };
        const onFailure = error => finish(error);
        // Observe work even after cancellation, so a later rejection is handled.
        Promise.resolve(work).then(value => finish(null, value), error => finish(error));
        if (failure) { finish(failure); return; }
        pending.add(onFailure);
        timer = setTimeout(() => finish(new Error(message)), timeout);
      });
    },
    dispose() { signal?.removeEventListener('abort', onAbort); }
  };
}

async function findSupportedConfig(width, height, fps, session) {
  session.check();
  const invalid = dimensionsError(width, height, fps);
  if (invalid) return { supported: false, reason: invalid };
  if (globalThis.isSecureContext === false || typeof globalThis.VideoEncoder !== 'function' || typeof globalThis.VideoFrame !== 'function') {
    return { supported: false, reason: BROWSER_HELP };
  }

  const bitrate = Math.round(Math.min(40_000_000, Math.max(4_000_000, width * height * fps * 0.28)));
  for (const codec of CODECS) {
    session.check();
    const config = {
      codec, width, height, bitrate, framerate: fps,
      latencyMode: 'quality', hardwareAcceleration: 'no-preference',
      avc: { format: 'avc' }, alpha: 'discard'
    };
    let work;
    try { work = VideoEncoder.isConfigSupported(config); }
    catch { continue; }
    const support = await session.wait(
      Promise.resolve(work).catch(() => ({ supported: false })),
      8_000,
      'The browser did not respond to the MP4 capability check. Reload this study and try again.'
    );
    if (support.supported) return { supported: true, config };
  }
  return {
    supported: false,
    reason: `H.264 export is unavailable at ${width} × ${height}. Try the smaller video size. ${BROWSER_HELP}`
  };
}

/** Check the exact size before the UI starts an export. AbortError is preserved. */
export async function checkVideoSupport({ width, height, fps = 30, signal } = {}) {
  const session = createSession(signal);
  try {
    return await findSupportedConfig(width, height, fps, session);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return { supported: false, reason: error.message };
  } finally {
    session.dispose();
  }
}

async function waitForQueue(encoder, session) {
  if (encoder.encodeQueueSize < MAX_ENCODE_QUEUE) return;
  let onDequeue;
  try {
    await session.wait(new Promise(resolve => {
      onDequeue = () => { if (encoder.encodeQueueSize < MAX_ENCODE_QUEUE) resolve(); };
      encoder.addEventListener('dequeue', onDequeue);
      onDequeue();
    }), 25_000, 'The MP4 encoder stopped responding. Try the smaller video size or reload this study.');
  } finally {
    encoder.removeEventListener('dequeue', onDequeue);
  }
  session.check();
}

/**
 * Export every frame at fixed presentation timestamps. With whole-frame clip
 * durations (the UI presets), this is exactly fps frames per second. Otherwise
 * the final frame is shortened to keep the requested duration, to 1 microsecond.
 * Visual sampling spans [0, 1] over the available frames, including the completed
 * composition in the final frame without adding an extra frame to the clip.
 * Seamless loops sample [0, 1) at presentation time so the join has no duplicate
 * endpoint or extra hold frame.
 */
export async function exportGrowthVideo({ width, height, duration, fps = 30, renderFrame, onProgress, signal, seamlessLoop = false } = {}) {
  const invalid = dimensionsError(width, height, fps);
  if (invalid) throw new Error(invalid);
  if (!Number.isFinite(duration) || duration < 2 / fps || duration > 120) {
    throw new Error(`Choose a video duration between ${(2 / fps).toFixed(2)} and 120 seconds.`);
  }
  if (typeof renderFrame !== 'function') throw new TypeError('A video frame renderer is required.');
  if (onProgress != null && typeof onProgress !== 'function') throw new TypeError('onProgress must be a function.');

  const totalMicroseconds = Math.round(duration * 1_000_000);
  const frames = Math.ceil(duration * fps - 1e-8);
  const session = createSession(signal);
  let encoder;
  let outputFrames = 0;
  let hasDecoderConfiguration = false;
  const frameDurations = new Map();
  const progress = (phase, value, frame) => {
    session.check();
    onProgress?.({ phase, progress: value, frame, frames });
    session.check();
  };

  try {
    progress('preparing', 0, 0);
    const support = await findSupportedConfig(width, height, fps, session);
    if (!support.supported) throw new Error(support.reason);
    const { default: Mp4Muxer } = await session.wait(
      import('./vendor/mp4-muxer.min.js'), 15_000,
      'The MP4 exporter could not load. Check your connection and reload this study.'
    );
    session.check();
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({
      target,
      video: { codec: 'avc', width, height },
      fastStart: 'in-memory'
    });

    encoder = new VideoEncoder({
      output(chunk, metadata) {
        try {
          session.check();
          const frameDuration = frameDurations.get(chunk.timestamp);
          if (frameDuration == null) throw new Error('The MP4 encoder returned an unexpected frame timestamp.');
          frameDurations.delete(chunk.timestamp);
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          // Use the scheduled duration even when a browser omits chunk.duration.
          muxer.addVideoChunkRaw(data, chunk.type, chunk.timestamp, frameDuration, metadata);
          if (metadata?.decoderConfig?.description?.byteLength) hasDecoderConfiguration = true;
          outputFrames++;
        } catch (error) { session.fail(error); }
      },
      error(error) {
        session.fail(new Error(`The MP4 encoder failed: ${error.message || error}. Try the smaller video size or reload this study.`));
      }
    });
    encoder.configure(support.config);

    for (let index = 0; index < frames; index++) {
      session.check();
      await waitForQueue(encoder, session);
      const timeline = seamlessLoop ? index / (duration * fps) : index / (frames - 1);
      const canvas = await session.wait(
        renderFrame(timeline, timeline * duration), 30_000,
        'A video frame took too long to render. Try the smaller video size.'
      );
      session.check();
      if (!canvas || canvas.width !== width || canvas.height !== height) {
        throw new Error(`The video renderer must return a ${width} × ${height} canvas.`);
      }
      const timestamp = Math.round(index * 1_000_000 / fps);
      const nextTimestamp = Math.min(totalMicroseconds, Math.round((index + 1) * 1_000_000 / fps));
      const frameDuration = nextTimestamp - timestamp;
      frameDurations.set(timestamp, frameDuration);
      const frame = new VideoFrame(canvas, { timestamp, duration: frameDuration, alpha: 'discard' });
      try { encoder.encode(frame, { keyFrame: index % (fps * 2) === 0 }); }
      finally { frame.close(); }
      session.check();
      progress('rendering', ((index + 1) / frames) * 0.95, index + 1);
      if (index % 4 === 3 || index === frames - 1) {
        // Give controls, cancellation and paint a turn even with a fast encoder.
        await session.wait(new Promise(resolve => setTimeout(resolve, 0)), 30_000,
          'Video export was interrupted. Keep this tab open and try again.');
      }
    }

    progress('finalizing', 0.95, frames);
    await session.wait(encoder.flush(), 45_000,
      'The MP4 encoder could not finish. Try the smaller video size or reload this study.');
    session.check();
    if (outputFrames !== frames || frameDurations.size || !hasDecoderConfiguration) {
      throw new Error('The browser did not encode every video frame. Try the smaller video size or reload this study.');
    }
    muxer.finalize();
    session.check();
    if (!target.buffer?.byteLength) throw new Error('The MP4 exporter produced an empty file. Please try again.');
    const blob = new Blob([target.buffer], { type: MIME_TYPE });
    progress('complete', 1, frames);
    return { blob, mimeType: MIME_TYPE, extension: 'mp4', frames, width, height, duration: totalMicroseconds / 1_000_000 };
  } finally {
    session.dispose();
    if (encoder && encoder.state !== 'closed') encoder.close();
    frameDurations.clear();
  }
}
