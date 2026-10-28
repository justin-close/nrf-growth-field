// Geometry-level framing checks against the actual resetView implementation.
// Run: node tests/framing-test.mjs
// Only browser UI and OrbitControls' camera-limit update are substituted; camera
// projection and all model geometry use the production Three.js implementation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as THREE from '../vendor/three.module.min.js';
import { defaults, buildModel, edgeSamples } from '../model.mjs';
import { updateCascadingModel } from '../cascading.mjs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const begin = app.indexOf('function resetView('), end = app.indexOf('\nfunction disposeGroup(', begin);
assert(begin >= 0 && end > begin, 'resetView must be available for direct projection testing');
const reset = new Function('THREE', 'art', 'model', 'state', 'camera', 'controls', 'pivot', '$$', 'view', 'matchMedia',
  `let dirty = false;\n${app.slice(begin, end)}\nresetView(view);\nreturn dirty;`);
const configuredMaxDistance = Number(app.match(/controls\.maxDistance\s*=\s*([\d.]+)/)?.[1]);
assert(Number.isFinite(configuredMaxDistance), 'read the production initial camera-distance limit');
const axis = new THREE.Vector3(0, 1, 0);
const forms = ['ascent', 'multiply', 'network', 'cascading', 'radial', 'shell', 'bifurcation'];
const views = ['perspective', 'front', 'top'];

function frame(settings, aspect, view, startingAngle = 0, compact = false) {
  const state = { ...defaults, ...settings }, model = buildModel(state);
  const artworkPoints = model.points.map(p => new THREE.Vector3(...p.pos));
  const points = model.framingPoints ? model.framingPoints.map(p => new THREE.Vector3(...p)) : artworkPoints;
  // Framing bounds include the complete animated surface or trajectories.
  const pivot = new THREE.Box3().setFromPoints(artworkPoints).getCenter(new THREE.Vector3());
  const art = new THREE.Group();
  art.rotation.y = startingAngle;
  art.position.copy(pivot).sub(pivot.clone().applyAxisAngle(axis, startingAngle));
  const camera = new THREE.PerspectiveCamera(36, aspect, .1, 200);
  const controls = {
    target: new THREE.Vector3(), minDistance: 3, maxDistance: configuredMaxDistance,
    update() {
      // OrbitControls derives radius from the new camera position and applies
      // these limits before looking at its target. Preserve that constraint.
      const offset = camera.position.clone().sub(this.target);
      offset.setLength(THREE.MathUtils.clamp(offset.length(), this.minDistance, this.maxDistance));
      camera.position.copy(this.target).add(offset);
      camera.lookAt(this.target);
      camera.updateMatrixWorld();
    }
  };
  assert.equal(reset(THREE, art, model, state, camera, controls, pivot, () => [], view, () => ({ matches: compact })), true);
  return { state, model, points, pivot, art, camera, controls };
}

function assertInside(framed, points, angle, label) {
  const { camera, pivot } = framed;
  for (const point of points) {
    const projected = point.clone().sub(pivot).applyAxisAngle(axis, angle).add(pivot).project(camera);
    assert(projected.toArray().every(Number.isFinite), `${label}: finite projection`);
    assert(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && projected.z > -1 && projected.z < 1,
      `${label}: point outside camera frame (${projected.toArray().map(v => v.toFixed(4)).join(', ')}) at yaw ${angle.toFixed(3)}`);
  }
}

// This failed with the old heuristic of adding only one quarter of front depth.
test('wide Multiplicity front view preserves the entire rotating form', () => {
  const framed = frame({ form: 'multiply', seed: 1, spread: 65, depth: 100, turntable: true }, 2.3, 'front');
  for (let step = 0; step < 96; step++) assertInside(framed, framed.points, step * Math.PI / 48, 'original depth regression');
});

test('all seven systems and their complete bounds fit static portrait and wide views', () => {
  for (const form of forms) for (const aspect of [.55, .8, 1.5, 2.3]) for (const view of views) {
    const framed = frame({ form, seed: 4, spread: 100, depth: 100, twist: 125 }, aspect, view);
    const label = `${form}, aspect ${aspect}, ${view}`;
    assertInside(framed, framed.points, 0, label);
    // Check curved branches too, not just the points used by the fitter.
    if (form !== 'cascading') {
      const curvePoints = framed.model.edges.flatMap(edge => edgeSamples(framed.model, edge, form, 4).map(p => new THREE.Vector3(...p)));
      assertInside(framed, curvePoints, 0, `${label}, curves`);
    }
  }
});

test('turntable fits survive OrbitControls limits and intermediate yaw angles', () => {
  for (const form of forms) for (const aspect of [.55, .8, 2.3]) for (const view of views) {
    const framed = frame({ form, seed: 4, spread: 100, depth: 100, turntable: true }, aspect, view, Math.PI * .37);
    // The fitter samples 24 angles; validate four times as densely to exercise
    // positions between its samples, including after a rotated fit request.
    for (let step = 0; step < 96; step++) assertInside(framed, framed.points, step * Math.PI / 48,
      `${form}, aspect ${aspect}, ${view}, turntable`);
  }
});

test('extreme growth counts and fold settings remain inside the fitted camera planes', () => {
  for (const form of forms) {
    const framed = frame({ form, rate: 3, generations: 10, spread: 100, depth: 100, twist: -180, foldAmplitude: 1.8, folds: 20, turntable: true }, .8, 'perspective');
    for (let step = 0; step < 48; step++) assertInside(framed, framed.points, step * Math.PI / 24, `${form}, maximum density`);
  }
});

test('Cascading fits every animated growth stage without refitting its camera', () => {
  for (const foldSettings of [{foldAmplitude: 1.8, folds: 4}, {foldAmplitude: 1.8, folds: 20}]) {
    for (const view of views) {
      const framed = frame({form: 'cascading', ...foldSettings, turntable: true}, .55, view, 0, true);
      const initialCamera = framed.camera.position.toArray();
      for (const growth of [0, .1, .35, .6, .85, 1]) {
        const { positions } = updateCascadingModel(framed.model, framed.state, growth);
        const animatedPoints = [];
        for (let offset = 0; offset < positions.length; offset += 3) animatedPoints.push(new THREE.Vector3().fromArray(positions, offset));
        for (let step = 0; step < 16; step++) assertInside(framed, animatedPoints, step * Math.PI / 8,
          `Cascading ${foldSettings.folds} folds, ${view}, growth ${growth}`);
      }
      assert.deepEqual(framed.camera.position.toArray(), initialCamera);
    }
  }
});


test('mobile framing reserves the upper title area without clipping lower branches', () => {
  for (const form of forms) for (const view of views) {
    const framed = frame({ form, seed: 4, spread: 100, depth: 100, turntable: true }, .55, view, .7, true);
    for (let step = 0; step < 96; step++) {
      const angle = step * Math.PI / 48;
      assertInside(framed, framed.points, angle, `${form}, compact ${view}`);
      for (const point of framed.points) {
        const projected = point.clone().sub(framed.pivot).applyAxisAngle(axis, angle).add(framed.pivot).project(framed.camera);
        // This intentionally checks the product's visual reserve rather than
        // reconstructing the fitter's distance equations.
        assert(projected.y < .40, `${form}: mobile title reserve crossed`);
      }
    }
  }
});
