// Frozen cascading-surface reference for regression tests.
function buildRuffleSurface(options = {}) {
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const smooth = value => { const x = clamp(value, 0, 1); return x * x * (3 - 2 * x); };
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const growth = clamp(finite(options.growth, 1), 0, 1);
  const amplitude = clamp(finite(options.amplitude, 1), 0, 1.8);
  const folds = Math.round(clamp(finite(options.folds, 11), 4, 20));
  const radialCount = 32, angularCount = 384, TAU = Math.PI * 2;
  const expansion = smooth(growth);
  const radius = 3.1 * (.12 + .88 * expansion);
  const buckling = smooth((growth - .10) / .90);
  const secondaryGrowth = smooth((growth - .35) / .65);
  const points = [[0, 0, -.23]], rings = [], meridians = [], triangles = [];
  const at = (ring, sector) => 1 + (ring - 1) * angularCount + (sector + angularCount) % angularCount;

  for (let ring = 1; ring <= radialCount; ring++) {
    const t = ring / radialCount, ringIndices = [];
    const envelope = Math.pow(t, 3.1);
    for (let j = 0; j < angularCount; j++) {
      const angle = j / angularCount * TAU;
      const primaryPhase = folds * angle + (1.1 + 2.3 * expansion) * t;
      let wave = Math.sin(primaryPhase);
      {
        // Secondary folds concentrate near the rim, leaving the interior
        // smooth. Smooth weighting avoids discontinuous frequency switches.
        const edge = smooth((t - .48) / .52);
        wave += .48 * secondaryGrowth * edge * Math.sin(2 * folds * angle - 4.2 * t);
      }
      const modulation = .09 * Math.min(amplitude, 1.2) * buckling * envelope * Math.cos(primaryPhase);
      const r = radius * t * (1 + modulation);
      const z = -.23 + .5 * expansion * t * t + 1.12 * amplitude * buckling * envelope * wave;
      ringIndices.push(points.length);
      points.push([r * Math.cos(angle), r * Math.sin(angle), z]);
    }
    rings.push(ringIndices);
  }

  for (let j = 0; j < angularCount; j++) {
    triangles.push(0, at(1, j), at(1, j + 1));
    const meridian = [0];
    for (let ring = 1; ring <= radialCount; ring++) meridian.push(at(ring, j));
    meridians.push(meridian);
  }
  for (let ring = 2; ring <= radialCount; ring++) {
    for (let j = 0; j < angularCount; j++) {
      const a = at(ring - 1, j), b = at(ring - 1, j + 1), c = at(ring, j), d = at(ring, j + 1);
      triangles.push(a, c, b, b, c, d);
    }
  }

  const rim = rings[radialCount - 1].slice();
  let rimLength = 0, area = 0;
  for (let j = 0; j < rim.length; j++) {
    const a = points[rim[j]], b = points[rim[(j + 1) % rim.length]];
    rimLength += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  for (let i = 0; i < triangles.length; i += 3) {
    const a = points[triangles[i]], b = points[triangles[i + 1]], c = points[triangles[i + 2]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    area += .5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  const bounds = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
  for (const point of points) for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
  }
  return {
    points, rings, meridians, triangles, rim,
    metrics: {
      rimRatio: rimLength / (TAU * radius),
      areaRatio: area / (Math.PI * radius * radius),
      radius, rimLength, area,
    },
    bounds,
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = {buildRuffleSurface};
