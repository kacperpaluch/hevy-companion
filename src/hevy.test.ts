import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTarget } from './engine.ts';

test('warmup-only and dropset-only appearances do not displace working sessions', async (t) => {
  process.env.HEVY_API_KEY = 'test';
  const { recentSessions } = await import('./hevy.ts');
  const exercise = (type: string, reps: number) => ({ exercise_template_id: 'X', sets: [{ type, weight_kg: 30, reps }] });
  const workout = (date: string, type: string, reps: number) => ({ start_time: date, title: date, exercises: [exercise(type, reps)] });
  const pages = [
    [workout('2026-10-27', 'warmup', 12), workout('2026-10-26', 'dropset', 12)],
    [workout('2026-10-25', 'normal', 6), workout('2026-10-24', 'failure', 5)],
  ];
  const calls: number[] = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const page = Number(new URL(String(input)).searchParams.get('page'));
    calls.push(page);
    return Response.json({ page_count: 2, workouts: pages[page - 1] });
  });
  const sessions = (await recentSessions(new Set(['X']))).get('X')!;
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(sessions.map((s) => s.date), ['2026-10-25', '2026-10-24']);
  assert.equal(nextTarget(sessions.map((s) => s.sets), { min: 8, max: 12, maxRpe: 9, increment: 2.5 }).action, 'decrease');
});
