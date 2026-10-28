// Pure motion invariants, independent of GPU/browser rendering.
// Run: node tests/motion-test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  motionDefaults, sanitizeMotion, timelineAt, pointTiming,
  movingPosition, traceAlpha, pulseAt
} from '../motion.mjs';

const modes = ['cascade', 'unfurl', 'pulse'];
const stateFor = overrides => ({ ...motionDefaults, generations: 8, ...overrides });
const near = (actual, expected, message, tolerance = 1e-9) => assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} ≈ ${expected}`);
const inRange = (value, low, high, message) => assert(Number.isFinite(value) && value >= low - 1e-10 && value <= high + 1e-10, `${message}: ${value} in [${low}, ${high}]`);

test('motion sanitization preserves accepted values and bounds duration/energy/stagger', () => {
  assert.deepEqual(sanitizeMotion(), motionDefaults);
  assert.deepEqual(sanitizeMotion({ motion: 'unknown', duration: NaN, energy: Infinity, stagger: '50', loop: 'false', turntable: 1 }), motionDefaults);
  assert.deepEqual(sanitizeMotion({ motion: 'pulse', duration: 40, energy: -1, stagger: 200, loop: true, turntable: true }), {
    sequence: 'growth', motion: 'pulse', duration: 24, energy: 0, stagger: 100, loop: true, turntable: true
  });
  assert.equal(sanitizeMotion({ duration: 1 }).duration, 6);
  assert.equal(sanitizeMotion({ duration: 7.5 }).duration, 7.5);
  for (const motion of modes) assert.equal(sanitizeMotion({ motion }).motion, motion);
});

test('non-looping motion starts at the seed and settles every point before its final hold', () => {
  for (const motion of modes) for (const generations of [3, 8, 10]) for (const stagger of [0, 50, 100]) {
    const state = stateFor({ motion, generations, stagger, energy: 100 });
    const first = timelineAt(0, state), last = timelineAt(1, state), hold = timelineAt(0.831, state);
    assert.equal(first.growth, 0);
    assert.equal(first.phase, 'Seed');
    assert.equal(last.growth, 1);
    assert.equal(last.phase, 'Hold');
    assert.equal(hold.phase, 'Hold');
    for (let g = 1; g <= generations; g++) for (const variation of [0, 0.5, 1]) {
      assert.equal(pointTiming(g, variation, first).alpha, 0);
      assert.equal(pointTiming(g, variation, first).amount, 0);
      for (const frame of [hold, last]) {
        assert.equal(pointTiming(g, variation, frame).age, 1);
        assert.equal(pointTiming(g, variation, frame).amount, 1);
        assert.equal(pointTiming(g, variation, frame).alpha, 1);
        assert.equal(traceAlpha(g, variation, 1, frame), 1);
      }
    }
    assert.deepEqual(pointTiming(0, 0.5, first), { age: 1, amount: 1, alpha: 1, pop: 0 });
  }
});

test('the same input always produces the same frame and point state', () => {
  for (const motion of modes) for (const loop of [false, true]) for (const progress of [0, 0.12, 0.42, 0.5, 0.79, 1]) {
    const state = stateFor({ motion, loop });
    const frame = timelineAt(progress, state);
    assert.deepEqual(timelineAt(progress, { ...state }), frame);
    assert.deepEqual(pointTiming(4, 0.4, frame), pointTiming(4, 0.4, timelineAt(progress, state)));
    assert.deepEqual(movingPosition([1, 2, 3], [-1, 0, 2], 4, 0.4, frame), movingPosition([1, 2, 3], [-1, 0, 2], 4, 0.4, frame));
  }
});

test('loop endpoints match in geometry, alpha, pulse and camera orientation', () => {
  for (const motion of modes) for (const duration of [6, 7.5, 9, 12, 18, 24]) {
    const state = stateFor({ motion, duration, loop: true, turntable: true, energy: 100, stagger: 100 });
    const first = timelineAt(0, state), last = timelineAt(1, state);
    assert.equal(first.growth, last.growth);
    assert.equal(first.clock, last.clock);
    near(Math.cos(first.turn), Math.cos(last.turn), 'turntable cosine closes');
    near(Math.sin(first.turn), Math.sin(last.turn), 'turntable sine closes');
    for (let g = 0; g <= state.generations; g++) for (const variation of [0, 0.4, 1]) {
      assert.deepEqual(pointTiming(g, variation, first), pointTiming(g, variation, last));
      assert.deepEqual(movingPosition([1, 2, 3], [-1, 0, 2], g, variation, first), movingPosition([1, 2, 3], [-1, 0, 2], g, variation, last));
      for (const fraction of [0, 0.5, 1]) {
        near(traceAlpha(g, variation, fraction, first), traceAlpha(g, variation, fraction, last), 'loop trace closes');
        near(pulseAt(g, variation, fraction, first), pulseAt(g, variation, fraction, last), 'loop pulse closes');
      }
    }
  }
});

test('growth is continuous at phase boundaries and symmetric on a return loop', () => {
  for (const motion of modes) for (const loop of [false, true]) {
    const state = stateFor({ motion, loop });
    for (const boundary of loop ? [0.06, 0.43, 0.57, 0.94] : [0.045, 0.83]) {
      near(timelineAt(boundary - 1e-8, state).growth, timelineAt(boundary + 1e-8, state).growth, 'growth is continuous', 1e-6);
    }
    if (loop) for (let index = 0; index <= 100; index++) {
      const progress = index / 100;
      near(timelineAt(progress, state).growth, timelineAt(1 - progress, state).growth, 'loop growth mirrors return');
    }
  }
});

test('visibility remains bounded and every motion position remains finite', () => {
  for (const motion of modes) for (const loop of [false, true]) for (const energy of [0, 50, 100]) for (const stagger of [0, 100]) {
    const state = stateFor({ motion, loop, energy, stagger, turntable: true });
    let previousGrowth = 0;
    for (let index = 0; index <= 100; index++) {
      const frame = timelineAt(index / 100, state);
      inRange(frame.growth, 0, 1, 'growth');
      inRange(frame.clock, 0, state.generations + 1.25, 'generation clock');
      if (!loop) assert(frame.growth >= previousGrowth);
      previousGrowth = frame.growth;
      for (let g = 0; g <= state.generations; g++) for (const variation of [0, 0.5, 1]) {
        const timing = pointTiming(g, variation, frame);
        inRange(timing.age, 0, 1, 'point age');
        inRange(timing.alpha, 0, 1, 'point alpha');
        // Birth overshoot is intentional. Alpha, rather than position, is clamped.
        inRange(timing.amount, 0, 1.28, 'bounded position overshoot');
        assert(movingPosition([1, 2, 3], [-1, 0, 2], g, variation, frame).every(Number.isFinite));
        for (const fraction of [0, 0.5, 1]) {
          inRange(traceAlpha(g, variation, fraction, frame), 0, 1, 'trace alpha');
          inRange(pulseAt(g, variation, fraction, frame), 0, 2.025, 'pulse strength');
          if (!energy) assert.equal(pulseAt(g, variation, fraction, frame), 0);
        }
      }
    }
  }
});

test('children begin at the supplied parent origin, and parents are visible before their children', () => {
  const parent = [0.5, -0.2, 1.5], final = [2, 1, -1];
  for (const motion of modes) for (const stagger of [0, 50, 100]) {
    const state = stateFor({ motion, stagger });
    for (let g = 1; g <= state.generations; g++) for (const childVariation of [0, 0.5, 1]) for (const parentVariation of [0, 0.5, 1]) {
      const birth = g - 1 + childVariation * stagger / 100 * 0.65;
      const newborn = { ...timelineAt(0, state), clock: birth };
      assert.equal(pointTiming(g, childVariation, newborn).age, 0);
      assert.deepEqual(movingPosition(final, parent, g, childVariation, newborn), parent);
      assert.equal(pointTiming(g - 1, parentVariation, newborn).alpha, 1, 'parent is visible before child birth');
      const arrived = { ...newborn, clock: birth + 1.2 + 1e-9 };
      const position = movingPosition(final, parent, g, childVariation, arrived);
      position.forEach((coordinate, axis) => near(coordinate, final[axis], 'child arrives at final position'));
    }
  }
});

test('duration presets preserve geometry and make pulse cycles close at the loop seam', () => {
  const durations = [6, 9, 12, 18, 24];
  for (const duration of durations) {
    const state = stateFor({ duration, loop: true });
    near(timelineAt(1, state).pulse / (Math.PI * 2), Math.max(2, Math.round(duration / 3)), 'pulse completes integer cycles');
    for (const progress of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      assert.equal(timelineAt(progress, state).growth, timelineAt(progress, stateFor({ loop: true })).growth);
    }
  }
  assert.equal(timelineAt(-1, stateFor()).progress, 0);
  assert.equal(timelineAt(2, stateFor()).progress, 1);
});

// Review diagnostic: visibility precedes children, but complete parent arrival
// currently can overlap a child's birth. A renderer using static parent origins
// must account for this overlap, or the branching motion may look detached.
test('diagnostic: maximum stagger overlaps parent arrival and child birth', t => {
  const state = stateFor({ stagger: 100 });
  const childGeneration = 4;
  const frame = { ...timelineAt(0, state), clock: childGeneration - 1 };
  const parent = pointTiming(childGeneration - 1, 1, frame);
  assert.equal(parent.alpha, 1);
  if (parent.age < 1) t.diagnostic(`Parent is visible but only ${(parent.age * 100).toFixed(1)}% through arrival when an unstaggered child is born. Static parent origins need renderer coordination.`);
});
