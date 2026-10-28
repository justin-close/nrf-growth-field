// The selected Cascading folds study, mapped from its polar XY sheet into
// the chart's XZ plane. This is geometric edge growth, not a mechanics solver.
export const CASCADING_DEFAULTS = { foldAmplitude: 1, folds: 11 };
export const CASCADING_BOUNDS = { foldAmplitude: [0, 1.8], folds: [4, 20] };
const RADIAL_COUNT = 32;
const ANGULAR_COUNT = 384;
const POINT_COUNT = 1 + RADIAL_COUNT * ANGULAR_COUNT;
const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const smooth = value => {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
};
const at = (ring, sector) => 1 + (ring - 1) * ANGULAR_COUNT + (sector + ANGULAR_COUNT) % ANGULAR_COUNT;
const angles = Array.from({ length: ANGULAR_COUNT }, (_, sector) => sector / ANGULAR_COUNT * TAU);
const cosines = angles.map(Math.cos);
const sines = angles.map(Math.sin);

export function sanitizeCascading(settings = {}) {
  return {
    foldAmplitude: clamp(finite(settings.foldAmplitude, 1), 0, 1.8),
    folds: Math.round(clamp(finite(settings.folds, 11), 4, 20)),
  };
}

function deform(settings, requestedGrowth, positions) {
  const { foldAmplitude: amplitude, folds } = sanitizeCascading(settings);
  const growth = clamp(finite(requestedGrowth, 1), 0, 1);
  const expansion = smooth(growth);
  const radius = 3.1 * (.12 + .88 * expansion);
  const buckling = smooth((growth - .10) / .90);
  const secondaryGrowth = smooth((growth - .35) / .65);
  positions[0] = 0;
  positions[1] = -.23;
  positions[2] = 0;

  for (let ring = 1; ring <= RADIAL_COUNT; ring++) {
    const t = ring / RADIAL_COUNT;
    const envelope = Math.pow(t, 3.1);
    const edge = smooth((t - .48) / .52);
    for (let sector = 0; sector < ANGULAR_COUNT; sector++) {
      const angle = angles[sector];
      const primaryPhase = folds * angle + (1.1 + 2.3 * expansion) * t;
      const wave = Math.sin(primaryPhase)
        + .48 * secondaryGrowth * edge * Math.sin(2 * folds * angle - 4.2 * t);
      const modulation = .09 * Math.min(amplitude, 1.2) * buckling * envelope * Math.cos(primaryPhase);
      const r = radius * t * (1 + modulation);
      const height = -.23 + .5 * expansion * t * t + 1.12 * amplitude * buckling * envelope * wave;
      const offset = at(ring, sector) * 3;
      positions[offset] = r * cosines[sector];
      positions[offset + 1] = height;
      positions[offset + 2] = -r * sines[sector];
    }
  }

  let rimLength = 0;
  for (let sector = 0; sector < ANGULAR_COUNT; sector++) {
    const a = at(RADIAL_COUNT, sector) * 3;
    const b = at(RADIAL_COUNT, sector + 1) * 3;
    rimLength += Math.hypot(positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]);
  }
  return { positions, rimRatio: rimLength / (TAU * radius), growth };
}

export function buildCascadingModel(settings = {}) {
  // Keep full-precision, full-growth reference points separate from the live
  // Float32 buffer so playback cannot change camera framing or export bounds.
  const reference = deform(settings, 1, new Float64Array(POINT_COUNT * 3));
  const points = Array.from({ length: POINT_COUNT }, (_, index) => ({
    pos: Array.from(reference.positions.subarray(index * 3, index * 3 + 3)),
    g: 0,
    variation: 0,
  }));
  const edges = [];
  for (let ring = 1; ring <= RADIAL_COUNT; ring++) {
    for (let sector = 0; sector < ANGULAR_COUNT; sector++) {
      const edge = { a: at(ring, sector), b: at(ring, sector + 1), g: 0 };
      if (ring === RADIAL_COUNT) edge.rim = true;
      edges.push(edge);
    }
  }
  for (let sector = 0; sector < ANGULAR_COUNT; sector += 16) {
    let previous = 0;
    for (let ring = 1; ring <= RADIAL_COUNT; ring++) {
      const next = at(ring, sector);
      edges.push({ a: previous, b: next, g: 0 });
      previous = next;
    }
  }
  // Match the selected study's sparse lattice markers, including its rim.
  const dotIndices = [0];
  for (let ring = 2; ring <= RADIAL_COUNT; ring += 3) {
    for (let sector = 0; sector < ANGULAR_COUNT; sector += 16) dotIndices.push(at(ring, sector));
  }
  const framingPoints = points.map(point => point.pos);
  for (const x of [-3.5, 3.5]) for (const height of [-3.1, 3.2]) for (const z of [-3.5, 3.5]) {
    framingPoints.push([x, height, z]);
  }
  return {
    kind: 'cascading', points, edges, levels: [], dotIndices, framingPoints,
    sampled: false, finalCount: POINT_COUNT, theoreticalTotal: POINT_COUNT,
    surface: {
      radialCount: RADIAL_COUNT,
      angularCount: ANGULAR_COUNT,
      rim: Array.from({ length: ANGULAR_COUNT }, (_, sector) => at(RADIAL_COUNT, sector)),
      rimRatio: reference.rimRatio,
      positions: new Float32Array(reference.positions),
    },
  };
}

export function updateCascadingModel(model, settings = {}, growth = 1) {
  return deform(settings, growth, model.surface.positions);
}
