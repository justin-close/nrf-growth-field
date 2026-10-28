import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as THREE from '../vendor/three.module.min.js';
import { createCascadingArtwork } from '../cascading-scene.mjs';
import { filamentFade } from '../finish.mjs';
import {
  buildCascadingModel, updateCascadingModel, sanitizeCascading,
} from '../cascading.mjs';

// The frozen cascading study is the visual contract for this system.
// Compare with that independent source rather than duplicating its formula.
const require = createRequire(import.meta.url);
const { buildRuffleSurface } = require('./fixtures/cascading-reference.cjs');
const sourceOptions = (settings, growth = 1) => ({
  preset: 'cascade', amplitude: settings.foldAmplitude, folds: settings.folds, growth,
});
const close = (actual, expected, tolerance = 1e-12) =>
  assert(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);

test('the final surface preserves the selected cascade study and its axis mapping', () => {
  for (const settings of [{}, { foldAmplitude: 0, folds: 4 }, { foldAmplitude: 1.8, folds: 20 }, { foldAmplitude: .6, folds: 7 }]) {
    const approved = buildRuffleSurface(sourceOptions(settings));
    const model = buildCascadingModel(settings);
    assert.equal(model.points.length, approved.points.length);
    for (let index = 0; index < approved.points.length; index++) {
      const [x, y, height] = approved.points[index];
      const position = model.points[index].pos;
      close(position[0], x);
      close(position[1], height);
      close(position[2], -y);
    }
    close(model.surface.rimRatio, approved.metrics.rimRatio);
  }
});

test('continuous playback matches the approved surface throughout growth', () => {
  const model = buildCascadingModel();
  for (const settings of [{}, { foldAmplitude: 1.8, folds: 20 }]) {
    for (const growth of [0, .1, .25, .35, .57, .8, 1]) {
      const approved = buildRuffleSurface(sourceOptions(settings, growth));
      const frame = updateCascadingModel(model, settings, growth);
      assert.equal(frame.growth, growth);
      for (let index = 0; index < approved.points.length; index++) {
        const [x, y, height] = approved.points[index];
        close(frame.positions[index * 3], x, 2e-7);
        close(frame.positions[index * 3 + 1], height, 2e-7);
        close(frame.positions[index * 3 + 2], -y, 2e-7);
      }
      close(frame.rimRatio, approved.metrics.rimRatio, 2e-6);
    }
  }
});

test('the mesh has complete rings, 24 radial paths, a distinct rim, and sparse study dots', () => {
  const model = buildCascadingModel();
  const approved = buildRuffleSurface(sourceOptions({}));
  assert.equal(model.kind, 'cascading');
  assert.equal(model.points.length, 12289);
  assert.equal(model.edges.length, 13056);
  assert.equal(model.edges.filter(edge => edge.rim).length, 384);
  const actual = new Set(model.edges.map(edge => [edge.a, edge.b].sort((a, b) => a - b).join(':')));
  assert.equal(actual.size, model.edges.length, 'no repeated edges');
  const hasEdge = (a, b) => assert(actual.has([a, b].sort((x, y) => x - y).join(':')), `missing edge ${a}–${b}`);
  for (const ring of approved.rings) ring.forEach((index, sector) => hasEdge(index, ring[(sector + 1) % ring.length]));
  for (let sector = 0; sector < approved.meridians.length; sector += 16) {
    const meridian = approved.meridians[sector];
    for (let index = 1; index < meridian.length; index++) hasEdge(meridian[index - 1], meridian[index]);
  }
  assert.deepEqual(model.surface.rim, approved.rim);
  const expectedDots = [0];
  for (let ring = 1; ring < approved.rings.length; ring += 3) {
    for (let sector = 0; sector < approved.rings[ring].length; sector += 16) expectedDots.push(approved.rings[ring][sector]);
  }
  assert.deepEqual(model.dotIndices, expectedDots);
  assert(model.edges.every(edge => edge.g === 0 && model.points[edge.a] && model.points[edge.b]));
  assert(model.points.every(point => point.g === 0 && point.variation === 0));
  assert.deepEqual(model.levels, []);
  assert.equal(model.sampled, false);
  assert.equal(model.finalCount, model.points.length);
  assert.equal(model.theoreticalTotal, model.points.length);
});

test('playback reuses its vertex buffer and leaves reference geometry and settings unchanged', () => {
  const settings = Object.freeze({ foldAmplitude: 1.2, folds: 14 });
  const model = buildCascadingModel(settings);
  const reference = structuredClone(model.points);
  const frameBounds = structuredClone(model.framingPoints);
  const first = updateCascadingModel(model, settings, .2);
  assert(first.positions instanceof Float32Array);
  const early = first.positions.slice();
  const second = updateCascadingModel(model, settings, .8);
  assert.strictEqual(first.positions, second.positions);
  assert.notDeepEqual(early, second.positions);
  assert.deepEqual(model.points, reference);
  assert.deepEqual(model.framingPoints, frameBounds);
});

test('fold controls are effective while unrelated synthetic growth controls have no effect', () => {
  const baseline = buildCascadingModel();
  assert.deepEqual(baseline, buildCascadingModel());
  assert.notDeepEqual(baseline.points, buildCascadingModel({ folds: 7 }).points);
  assert.notDeepEqual(baseline.points, buildCascadingModel({ foldAmplitude: .3 }).points);
  const unrelated = {
    rate: 3, generations: 10, spread: 100, depth: 0, twist: 180,
    seed: 985, palette: 5, style: 'dots', motion: 'pulse',
  };
  assert.deepEqual(buildCascadingModel(unrelated), baseline);
  assert.deepEqual(
    updateCascadingModel(buildCascadingModel(), unrelated, .6),
    updateCascadingModel(buildCascadingModel(), {}, .6),
  );
});

test('zero growth starts as a small flat sheet and deformation stays continuous at its onsets', () => {
  const model = buildCascadingModel();
  const first = updateCascadingModel(model, {}, 0).positions;
  let radius = 0;
  for (let offset = 0; offset < first.length; offset += 3) {
    close(first[offset + 1], -.23, 1e-8);
    radius = Math.max(radius, Math.hypot(first[offset], first[offset + 2]));
  }
  close(radius, 3.1 * .12, 3e-8);
  for (const onset of [.1, .35]) {
    const before = updateCascadingModel(model, {}, onset - 1e-5).positions.slice();
    const after = updateCascadingModel(model, {}, onset + 1e-5).positions;
    let displacement = 0;
    for (let index = 0; index < after.length; index++) displacement = Math.max(displacement, Math.abs(after[index] - before[index]));
    assert(displacement < .0001, `discontinuous deformation at growth ${onset}`);
  }
});

test('all allowed fold counts and growth poses remain inside the chart reference volume', () => {
  const model = buildCascadingModel();
  const bounds = { min: [-3.5, -3.1, -3.5], max: [3.5, 3.2, 3.5] };
  for (const amplitude of [0, 1, 1.8]) for (let folds = 4; folds <= 20; folds++) {
    for (let step = 0; step <= 20; step++) {
      const { positions, rimRatio } = updateCascadingModel(model, { foldAmplitude: amplitude, folds }, step / 20);
      assert(Number.isFinite(rimRatio) && rimRatio > 0);
      for (let index = 0; index < positions.length; index++) {
        const axis = index % 3;
        assert(Number.isFinite(positions[index]));
        assert(positions[index] >= bounds.min[axis] && positions[index] <= bounds.max[axis]);
      }
    }
  }
  for (const x of [-3.5, 3.5]) for (const y of [-3.1, 3.2]) for (const z of [-3.5, 3.5]) {
    assert(model.framingPoints.some(point => point[0] === x && point[1] === y && point[2] === z));
  }
  assert.equal(model.framingPoints.length, model.points.length + 8);
});

test('control bounds and invalid inputs match the selected study', () => {
  assert.deepEqual(sanitizeCascading(), { foldAmplitude: 1, folds: 11 });
  assert.deepEqual(sanitizeCascading({ foldAmplitude: NaN, folds: Infinity }), { foldAmplitude: 1, folds: 11 });
  assert.deepEqual(sanitizeCascading({ foldAmplitude: -1, folds: -20 }), { foldAmplitude: 0, folds: 4 });
  assert.deepEqual(sanitizeCascading({ foldAmplitude: 99, folds: 99 }), { foldAmplitude: 1.8, folds: 20 });
  assert.equal(sanitizeCascading({ folds: 10.7 }).folds, 11);
  const model = buildCascadingModel();
  assert.equal(updateCascadingModel(model, {}, -1).growth, 0);
  assert.equal(updateCascadingModel(model, {}, 9).growth, 1);
  assert.equal(updateCascadingModel(model, {}, NaN).growth, 1);
  assert.equal(updateCascadingModel(model, {}, Infinity).growth, 1);
});

const artworkSettings = {
  foldAmplitude: 1, folds: 11, dotSize: 3, lineOpacity: 35,
  style: 'connected', filamentFinish: 'off', fadeStrength: 65,
};
const artworkPalette = {primary: '#5AEB41'};

test('Cascading finish off preserves line opacity and keeps dots circular and unfaded', () => {
  const model = buildCascadingModel();
  const artwork = createCascadingArtwork(THREE, model, artworkSettings, artworkPalette);
  const mesh = artwork.group.getObjectByName('lines');
  const rim = artwork.group.getObjectByName('cascading-rim');
  const dots = artwork.group.getObjectByName('dots');
  const snapshot = artwork.snapshot();
  assert(snapshot.lineFade instanceof Float32Array);
  assert.equal(snapshot.lineFade.length, model.points.length);
  assert(snapshot.lineFade.every(value => value === 1));
  close(snapshot.meshOpacity, .42);
  close(snapshot.rimOpacity, .9625);
  assert.strictEqual(mesh.geometry.getAttribute('aFilamentFade'), rim.geometry.getAttribute('aFilamentFade'));
  assert.strictEqual(mesh.geometry.getAttribute('aFilamentFade').array, snapshot.lineFade);
  assert.equal(dots.geometry.getAttribute('aFilamentFade'), undefined);
  assert.match(dots.material.fragmentShader, /length\(gl_PointCoord - \.5\)/);
  assert.doesNotMatch(dots.material.fragmentShader, /FilamentFade/);

  // Exercise the hooks against the bundled Three shader, so a chunk-name
  // mismatch cannot silently turn the finish into an inactive attribute.
  for (const material of [mesh.material, rim.material]) {
    assert.equal(material.isLineBasicMaterial, true);
    const shader = {
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    };
    material.onBeforeCompile(shader);
    assert.match(shader.vertexShader, /attribute float aFilamentFade;/);
    assert.match(shader.vertexShader, /vFilamentFade = aFilamentFade;/);
    assert.match(shader.fragmentShader, /diffuseColor\.a \*= vFilamentFade;/);
    assert(shader.fragmentShader.indexOf('diffuseColor.a *= vFilamentFade;') < shader.fragmentShader.indexOf('#include <alphatest_fragment>'));
  }
});

test('Cascading finishes update shared alpha in place without changing geometry or dot appearance', () => {
  const model = buildCascadingModel();
  const artwork = createCascadingArtwork(THREE, model, artworkSettings, artworkPalette);
  const mesh = artwork.group.getObjectByName('lines');
  const rim = artwork.group.getObjectByName('cascading-rim');
  const dots = artwork.group.getObjectByName('dots');
  const vertexAttribute = mesh.geometry.getAttribute('position');
  const alphaAttribute = mesh.geometry.getAttribute('aFilamentFade');
  const vertexSnapshot = vertexAttribute.array.slice();
  const alphaBuffer = artwork.snapshot().lineFade;
  const geometryIds = artwork.group.children.map(child => child.geometry.uuid);
  const dotShader = dots.material.fragmentShader;
  const previousVersion = alphaAttribute.version;
  artwork.setStyle({...artworkSettings, filamentFinish: 'silk', fadeStrength: 100});
  assert.strictEqual(artwork.snapshot().lineFade, alphaBuffer);
  assert(alphaAttribute.version > previousVersion);
  assert(alphaBuffer.some(value => value < .2));
  assert(alphaBuffer.some(value => value > .8));
  assert.deepEqual(vertexAttribute.array, vertexSnapshot);
  assert.strictEqual(rim.geometry.getAttribute('position'), vertexAttribute);
  assert.strictEqual(dots.geometry.getAttribute('position'), vertexAttribute);
  assert.deepEqual(artwork.group.children.map(child => child.geometry.uuid), geometryIds);
  assert.equal(dots.material.fragmentShader, dotShader);
  assert.equal(artwork.snapshot().dotOpacity, .82);
  close(artwork.snapshot().meshOpacity, .42);
  close(artwork.snapshot().rimOpacity, .9625);

  const fixedFade = alphaBuffer.slice();
  artwork.update(.35);
  assert.notDeepEqual(vertexAttribute.array, vertexSnapshot);
  assert.deepEqual(alphaBuffer, fixedFade, 'finish stays attached to the surface during growth');
  artwork.setStyle({...artworkSettings, filamentFinish: 'silk', fadeStrength: 0});
  assert(alphaBuffer.every(value => value === 1));
  artwork.setStyle({...artworkSettings, filamentFinish: 'veil', fadeStrength: 100, style: 'dots'});
  assert.equal(mesh.visible, false);
  assert.equal(rim.visible, false);
  assert.equal(dots.visible, true);
  artwork.setStyle({...artworkSettings, style: 'filaments'});
  assert.equal(mesh.visible, true);
  assert.equal(rim.visible, true);
  assert.equal(dots.visible, false);
  assert(alphaBuffer.every(value => value === 1), 'switching finish off restores the original mesh');
});

test('each Cascading ring uses the shared cyclic fade profile including the closing segment', () => {
  const model = buildCascadingModel();
  const artwork = createCascadingArtwork(THREE, model, artworkSettings, artworkPalette);
  const {radialCount, angularCount} = model.surface;
  const samples = new Map();
  for (const filamentFinish of ['silk', 'veil']) {
    const settings = {...artworkSettings, filamentFinish, fadeStrength: 100};
    artwork.setStyle(settings);
    const {lineFade} = artwork.snapshot();
    for (const ring of [1, 16, 32]) {
      const start = 1 + (ring - 1) * angularCount;
      for (const sector of [0, 96, 192, 383]) {
        close(lineFade[start + sector], filamentFade(sector / angularCount, ring / radialCount, settings), 3e-8);
      }
      close(lineFade[start], filamentFade(1, ring / radialCount, settings), 3e-8);
      assert(Math.abs(lineFade[start] - lineFade[start + angularCount - 1]) < .05, 'closing segment has no abrupt opacity seam');
    }
    assert(lineFade.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    samples.set(filamentFinish, lineFade.slice());
  }
  assert.notDeepEqual(samples.get('silk'), samples.get('veil'));
});
