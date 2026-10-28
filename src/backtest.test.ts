import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replay, summary } from './backtest.ts';
import type { HevySet } from './engine.ts';

const rule = { min: 8, max: 12, increment: 5, maxRpe: 9 };
const s = (weight_kg: number | null, reps: number | null): HevySet => ({ type: 'normal', weight_kg, reps });
// replay takes sessions newest-first; advice after [80×11, 80×10] is hold 80 kg × 11/11
const after = (...next: HevySet[]) => replay([next, [s(80, 11), s(80, 10)]], rule)[0].mark;

test('marks what was done next against the advice', () => {
  assert.equal(after(s(80, 12), s(80, 11)), '=');
  assert.equal(after(s(80, 13), s(80, 12)), '='); // beating the target still counts as on target
  assert.equal(after(s(85, 8), s(85, 8)), '↑');
  assert.equal(after(s(80, 12), s(80, 10)), '↓'); // second set short of 11
  assert.equal(after(s(80, 12), s(75, 12)), '↓'); // a set below the advised weight
  assert.equal(after(s(80, 12)), '='); // fewer sets: only the sets done are scored
  assert.equal(replay([[s(80, 12)], [s(80, 12), s(80, 12)]], { min: 8, max: 12, maxRpe: 9 })[0].mark, '·'); // no step → skip
});

test('steps read oldest first; the newest session has no next and no mark', () => {
  const steps = replay([[s(85, 8)], [s(80, 12), s(80, 12)], [s(80, 11), s(80, 10)]], rule);
  assert.deepEqual(steps.map((x) => [x.sets[0].weight_kg, x.result.action, x.mark]),
    [[80, 'hold', '='], [80, 'increase', '='], [85, 'hold', undefined]]);
  assert.deepEqual(summary(steps), { '=': 2, '↑': 0, '↓': 0, '·': 0 });
  assert.deepEqual(replay([], rule), []);
});

test('report: one line per session, rule header, per-exercise summary', async () => {
  const { report } = await import('./backtest.ts');
  const text = report('Wyciskanie nogami', rule, replay([[s(80, 12), s(80, 11)], [s(80, 11), s(80, 10)]], rule));
  assert.deepEqual(text.split('\n').map((l) => l.replace(/ +/g, ' ')), [
    '## Wyciskanie nogami · 8–12 · co 5 kg',
    ' 80×11 80×10 → hold 80 kg × 11/11 → 80×12 80×11 =',
    ' 80×12 80×11 → hold 80 kg × 12/12',
    ' podsumowanie: = 1 · ↑ 0 · ↓ 0 · pominięte 0',
  ]);
  const dumbbells = { min: 6, max: 10, maxRpe: 9, weights: [10, 12.5] };
  assert.match(report('Hantle', dumbbells, replay([[{ ...s(12.5, 9), rpe: 8 }]], dumbbells)), /lista ciężarów\n +12,5×9@8 +→ hold 12,5 kg × 10$/m);
  assert.match(report('Plank', { min: 8, max: 12, maxRpe: 9 }, []), /· bez skoku\n +brak historii/);
});
