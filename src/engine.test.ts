import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changes, expandWeights, nextTarget, toPutBody, type HevySet, type Result, type Routine } from './engine.ts';

const rule = { min: 8, max: 12, increment: 2.5, maxRpe: 9 };
const dumbbells = { ...rule, weights: expandWeights([[1, 10, 1], [12.5, 50, 2.5]]) };
const s = (weight_kg: number | null, reps: number | null, type = 'normal', rpe: number | null = null): HevySet => ({ type, weight_kg, reps, rpe });
const wr = (r: Result) => (r.action === 'skip' ? r.action : [r.action, r.weight, r.reps]);

// expected outcomes taken from Periodize's own prescriptions for the same history
test('all sets at top of range → add weight, reset to bottom', () => {
  assert.deepEqual(wr(nextTarget([[s(30, 14), s(30, 12)]], rule)), ['increase', 32.5, [8, 8]]);
});
test('not all sets at top → hold, each set +1 rep within the range', () => {
  assert.deepEqual(wr(nextTarget([[s(25, 13), s(25, 9)]], rule)), ['hold', 25, [12, 10]]);
  assert.deepEqual(wr(nextTarget([[s(12.5, 9), s(12.5, 8)]], rule)), ['hold', 12.5, [10, 9]]);
  assert.deepEqual(wr(nextTarget([[s(12.5, 9), s(12.5, 7)]], rule)), ['hold', 12.5, [10, 8]]); // set below range lifts to the bottom
});
test('warmups ignored; bodyweight, no history and excluded skipped', () => {
  assert.deepEqual(wr(nextTarget([[s(5, 20, 'warmup'), s(20, 9)]], rule)), ['hold', 20, [10]]);
  assert.equal(wr(nextTarget([[s(null, null)]], rule)), 'skip');
  assert.equal(wr(nextTarget([], rule)), 'skip');
  assert.equal(wr(nextTarget([[s(30, 14)]], { ...rule, exclude: true })), 'skip');
});

test('available weights: next real dumbbell, not +2.5', () => {
  assert.deepEqual(expandWeights([[1, 3, 1], [12.5, 17.5, 2.5]]), [1, 2, 3, 12.5, 15, 17.5]);
  assert.deepEqual(wr(nextTarget([[s(7, 12), s(7, 12)]], dumbbells)), ['increase', 8, [8, 8]]);
  assert.deepEqual(wr(nextTarget([[s(10, 12), s(10, 12)]], dumbbells)), ['increase', 12.5, [8, 8]]);
  assert.deepEqual(wr(nextTarget([[s(50, 12), s(50, 12)]], dumbbells)), ['hold', 50, [12, 12]]); // heaviest available
});
test('no step configured: rep targets still work, load changes ask for a step', () => {
  const noStep = { min: 8, max: 12, maxRpe: 9 };
  assert.deepEqual(wr(nextTarget([[s(30, 10), s(30, 9)]], noStep)), ['hold', 30, [11, 10]]);
  assert.equal(wr(nextTarget([[s(30, 12), s(30, 12)]], noStep)), 'skip');
  assert.equal(wr(nextTarget([[s(30, 6)], [s(30, 6)]], noStep)), 'skip');
});
test('high RPE at top of range blocks the increase', () => {
  assert.deepEqual(wr(nextTarget([[s(30, 12, 'normal', 8), s(30, 12, 'normal', 10)]], rule)), ['hold', 30, [12, 12]]);
  assert.deepEqual(wr(nextTarget([[s(30, 12, 'normal', 8), s(30, 12, 'normal', 9)]], rule)), ['increase', 32.5, [8, 8]]);
});
test('below range: one session holds, two in a row at same load steps back', () => {
  assert.deepEqual(wr(nextTarget([[s(12.5, 6), s(12.5, 5)]], dumbbells)), ['hold', 12.5, [8, 8]]);
  assert.deepEqual(wr(nextTarget([[s(12.5, 6), s(12.5, 5)], [s(12.5, 7), s(12.5, 6)]], dumbbells)), ['decrease', 10, [8, 8]]);
  // previous session at a different load → still only one attempt at this load
  assert.deepEqual(wr(nextTarget([[s(12.5, 6)], [s(10, 12)]], dumbbells)), ['hold', 12.5, [8]]);
});

test('PUT body rewrites only working sets and drops GET-only fields', () => {
  const routine = { id: 'r1', title: 'A', folder_id: null, exercises: [
    { index: 0, title: 'Curl', exercise_template_id: 'X', superset_id: null, rest_seconds: 90, notes: null,
      sets: [{ index: 0, ...s(10, 10, 'warmup') }, { index: 1, ...s(25, 11) }] },
    { index: 1, title: 'Plank', exercise_template_id: 'P', superset_id: null, rest_seconds: 60, notes: null,
      sets: [{ type: 'normal', weight_kg: null, reps: null, duration_seconds: 45 }] },
  ] } as unknown as Routine;
  const result = nextTarget([[s(25, 12), s(25, 12)]], rule);
  const body = toPutBody(routine, new Map([['X', result], ['P', nextTarget([], rule)]]));
  const [curl, plank] = body.routine.exercises;
  assert.equal('title' in curl || 'index' in curl.sets[0], false);
  assert.deepEqual(curl.sets.map((x) => [x.type, x.weight_kg, x.reps]), [['warmup', 10, 10], ['normal', 27.5, 8]]);
  assert.equal(plank.sets[0].duration_seconds, 45);
  assert.equal(changes(routine.exercises[0], result), true);
});

test('PUT body: per-set reps; routine sets beyond last session reuse the last target', () => {
  const routine = { id: 'r1', title: 'A', folder_id: null, exercises: [
    { exercise_template_id: 'X', superset_id: null, rest_seconds: 90, notes: null,
      sets: [s(10, 10, 'warmup'), s(12.5, 9), s(12.5, 7), s(12.5, 7)] },
  ] } as unknown as Routine;
  const result = nextTarget([[s(12.5, 9), s(12.5, 7)]], rule);
  const [ex] = toPutBody(routine, new Map([['X', result]])).routine.exercises;
  assert.deepEqual(ex.sets.map((x) => x.reps), [10, 10, 8, 8]);
  assert.equal(changes(routine.exercises[0], nextTarget([[s(12.5, 10), s(12.5, 8)]], rule)), true);
});
