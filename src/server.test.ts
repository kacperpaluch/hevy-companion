import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('HTTP preview, settings and push use the same per-occurrence targets', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'hevy-test-'));
  process.env.CONFIG_PATH = join(dir, 'config.json');
  process.env.HEVY_API_KEY = 'test';
  t.mock.method(console, 'error', () => {});
  const configPath = process.env.CONFIG_PATH;
  const historyPath = join(dir, 'history.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const exercise = (min: number, max: number) => ({ exercise_template_id: 'X', title: 'Test', notes: 'keep me',
    superset_id: 1, rest_seconds: 90, sets: [
      { type: 'warmup', weight_kg: 10, reps: 10 },
      { type: 'normal', weight_kg: 20, reps: 8, rep_range: { start: min, end: max } },
      { type: 'dropset', weight_kg: 15, reps: 8 },
    ] });
  const routine = { id: 'r1', title: 'Test', folder_id: null, updated_at: '2026-10-26', exercises: [exercise(8, 12), exercise(6, 8)] };
  const puts: any[] = [];
  let failPut = false, blockConfirmation = false;
  let waitForPut: Promise<void> | undefined, notifyPut: (() => void) | undefined;
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (!String(input).startsWith('https://api.hevyapp.com/v1/')) return realFetch(input, init);
    const path = new URL(String(input)).pathname;
    if (init?.method === 'PUT') {
      assert.equal(JSON.parse(readFileSync(historyPath, 'utf8')).r1.status, 'pending');
      notifyPut?.();
      if (waitForPut) await waitForPut;
      if (failPut) throw new Error('fixture: lost Hevy response');
      puts.push(JSON.parse(String(init.body)));
      if (blockConfirmation) mkdirSync(historyPath + '.tmp');
      return Response.json({});
    }
    if (path === '/v1/routines') return Response.json({ routines: [routine], page_count: 1 });
    if (path === '/v1/workouts') return Response.json({ page_count: 1, workouts: [
      { title: 'Warmup only', start_time: '2026-10-27', exercises: [{ exercise_template_id: 'X', sets: [{ type: 'warmup', weight_kg: 10, reps: 10 }] }] },
      ...['2026-10-26', '2026-10-25', '2026-10-24'].map((date) => ({ title: 'Working session', start_time: date,
        exercises: [{ exercise_template_id: 'X', sets: [{ type: 'normal', weight_kg: 20, reps: 10, rpe: 9 }] }] })),
    ] });
    if (path === '/v1/exercise_templates/X') return Response.json({ equipment: 'dumbbell', thumbnail_url: null });
    throw new Error(`Unexpected Hevy request: ${path}`);
  });
  const { server } = await import('./server.ts');
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close((e) => e ? reject(e) : resolve()); }));
  const address = server.address() as { port: number };
  const request = (path: string, body?: unknown, contentType = 'application/json') => fetch(`http://127.0.0.1:${address.port}${path}`,
    body === undefined ? {} : { method: 'POST', headers: { 'content-type': contentType }, body: JSON.stringify(body) });
  const preview = async () => (await (await request('/api/plan')).json()).routines[0];

  await t.test('duplicate IDs keep separate targets from preview through PUT', async () => {
    const plan = await preview();
    assert.deepEqual(plan.exercises.map((e: any) => [e.result.weight, e.result.reps]), [[20, [11]], [22.5, [6]]]);
    assert.equal(plan.exercises[0].last.date, '2026-10-26');
    const res = await request('/api/routines/r1/push', { fingerprint: plan.fingerprint, acknowledgeNoteLoss: true, selected: [0, 1] });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { changed: 2 });
    assert.equal(puts.length, 1);
    puts[0].routine.exercises.forEach((ex: any, i: number) => {
      assert.deepEqual([ex.sets[1].weight_kg, ex.sets[1].reps], [plan.exercises[i].result.weight, plan.exercises[i].result.reps[0]]);
      assert.deepEqual(ex.sets[0], { ...routine.exercises[i].sets[0], distance_meters: null, duration_seconds: null, custom_metric: null });
      assert.equal(ex.sets[2].type, 'dropset');
      assert.equal(ex.sets[2].weight_kg, 15);
      assert.equal(ex.notes, 'keep me');
      assert.equal(ex.rest_seconds, 90);
      assert.equal(ex.superset_id, 1);
      assert.deepEqual(ex.sets[1].rep_range, routine.exercises[i].sets[1].rep_range);
    });
  });

  await t.test('missing consent, stale preview and non-JSON requests never write', async () => {
    const plan = await preview();
    for (const acknowledgement of [undefined, false, 'true']) {
      const res = await request('/api/routines/r1/push', { fingerprint: plan.fingerprint, acknowledgeNoteLoss: acknowledgement, selected: [0, 1] });
      assert.equal(res.status, 400);
      assert.match((await res.json()).error, /notatkę/);
    }
    routine.updated_at = '2026-10-27';
    assert.equal((await request('/api/routines/r1/push', { fingerprint: plan.fingerprint, acknowledgeNoteLoss: true })).status, 409);
    assert.equal((await request('/api/routines/r1/push', {}, 'text/plain')).status, 415);
    assert.equal(puts.length, 1);
  });

  await t.test('settings validation and cached preview preserve per-occurrence results', async () => {
    assert.equal((await request('/api/exercises/X/settings', { increment: 7 })).status, 400);
    assert.equal((await request('/api/exercises/X/settings', { range: [1, 99] })).status, 400);
    const before = await preview();
    assert.equal((await request('/api/exercises/X/settings', { increment: 5 })).status, 200);
    assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).exercises.X.increment, 5);
    const after = (await (await request('/api/plan?cached=1')).json()).routines[0];
    assert.deepEqual(after.exercises.map((e: any) => e.result.weight), [20, 25]);
    assert.equal((await request('/api/routines/r1/push', { fingerprint: before.fingerprint, acknowledgeNoteLoss: true })).status, 409);
    assert.equal(puts.length, 1);
  });

  await t.test('invalid weight config returns an error and the server recovers', async () => {
    writeFileSync(configPath, JSON.stringify({ exercises: { X: { weights: [[1, 10, 0]] } } }));
    t.mock.method(console, 'error', () => {});
    const res = await request('/api/plan');
    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /krok > 0/);
    writeFileSync(configPath, '{}');
    assert.equal((await request('/api/plan')).status, 200);
  });

  await t.test('only the selected occurrence changes; backup persists original values and history', async () => {
    const plan = await preview();
    assert.equal(plan.exercises[0].stalled, true);
    assert.equal(plan.exercises[0].recent.length, 3);
    const res = await request('/api/routines/r1/push', { fingerprint: plan.fingerprint, acknowledgeNoteLoss: true, selected: [1] });
    assert.deepEqual(await res.json(), { changed: 1 });
    const sent = puts.at(-1).routine.exercises;
    assert.deepEqual(sent[0], JSON.parse(readFileSync(historyPath, 'utf8')).r1.before.routine.exercises[0]);
    assert.equal(sent[1].sets[1].weight_kg, 22.5);
    const backup = await request('/api/routines/r1/backup');
    assert.equal(backup.status, 200);
    assert.match(backup.headers.get('content-disposition')!, /attachment/);
    const record = await backup.json();
    assert.equal(record.status, 'confirmed');
    assert.ok(Number.isFinite(Date.parse(record.date)));
    assert.equal(record.before.routine.exercises[1].sets[1].weight_kg, 20);
    assert.equal(record.after.routine.exercises[1].sets[1].weight_kg, 22.5);
    assert.deepEqual(record.changes.map((c: any) => c.index), [1]);
    assert.deepEqual((await preview()).history, { date: record.date, status: record.status, changes: record.changes });
    assert.equal((await request('/api/routines/missing/backup')).status, 404);
  });

  await t.test('invalid or empty selections do not write or replace the backup', async () => {
    const plan = await preview(), before = readFileSync(historyPath, 'utf8'), count = puts.length;
    for (const selected of [undefined, [0, 0], [-1], [2], [0.5], ['0'], {}, null]) {
      assert.equal((await request('/api/routines/r1/push', { fingerprint: plan.fingerprint, acknowledgeNoteLoss: true, selected })).status, 400);
    }
    const empty = await request('/api/routines/r1/push', { fingerprint: plan.fingerprint, selected: [] });
    assert.deepEqual(await empty.json(), { changed: 0 });
    assert.equal(puts.length, count);
    assert.equal(readFileSync(historyPath, 'utf8'), before);
  });

  await t.test('RPE and exclusion settings are validated, persisted and reversible', async () => {
    for (const patch of [{ maxRpe: 0 }, { maxRpe: 11 }, { maxRpe: '9' }, { exclude: 'false' }, { range: { 0: 8, 1: 12 } }])
      assert.equal((await request('/api/exercises/X/settings', patch)).status, 400);
    const original = await preview();
    assert.equal((await request('/api/exercises/X/settings', { maxRpe: 7.5 })).status, 200);
    const limited = await preview();
    assert.equal(limited.exercises[1].result.weight, 20);
    assert.equal(limited.exercises[1].rpe.value, 7.5);
    assert.equal((await request('/api/routines/r1/push', { fingerprint: original.fingerprint, selected: [1], acknowledgeNoteLoss: true })).status, 409);
    assert.equal((await request('/api/exercises/X/settings', { exclude: true })).status, 200);
    const excluded = await preview();
    assert.ok(excluded.exercises.every((e: any) => e.excluded && !e.changed && e.result.action === 'skip'));
    assert.equal(excluded.exercises[0].rpe.value, 7.5);
    assert.equal((await request('/api/routines/r1/push', { fingerprint: excluded.fingerprint, selected: [0], acknowledgeNoteLoss: true })).status, 400);
    assert.equal((await request('/api/exercises/X/settings', { exclude: false, maxRpe: null })).status, 200);
    assert.equal((await preview()).exercises[1].result.weight, 22.5);
    assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).exercises?.X?.exclude, undefined);
  });

  await t.test('a missing Hevy response keeps the backup and marks the result unknown', async () => {
    const plan = await preview();
    failPut = true;
    try {
      const res = await request('/api/routines/r1/push', { fingerprint: plan.fingerprint, selected: [0], acknowledgeNoteLoss: true });
      assert.equal(res.status, 502);
      assert.match((await res.json()).error, /Hevy mogło już zapisać/);
      const record = JSON.parse(readFileSync(historyPath, 'utf8')).r1;
      assert.equal(record.status, 'unknown');
      assert.equal(record.before.routine.exercises[0].sets[1].weight_kg, 20);
      assert.equal((await preview()).history.status, 'unknown');
    } finally { failPut = false; }
  });

  await t.test('backup failure prevents any call that changes Hevy', async () => {
    const plan = await preview(), count = puts.length, before = readFileSync(historyPath, 'utf8');
    mkdirSync(historyPath + '.tmp');
    try {
      assert.equal((await request('/api/routines/r1/push', { fingerprint: plan.fingerprint, selected: [0], acknowledgeNoteLoss: true })).status, 500);
      assert.equal(puts.length, count);
      assert.equal(readFileSync(historyPath, 'utf8'), before);
    } finally { rmSync(historyPath + '.tmp', { recursive: true }); }
  });

  await t.test('history confirmation failure reports successful Hevy save and preserves the backup', async () => {
    const plan = await preview();
    blockConfirmation = true;
    try {
      const res = await request('/api/routines/r1/push', { fingerprint: plan.fingerprint, selected: [0], acknowledgeNoteLoss: true });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.changed, 1);
      assert.match(body.historyWarning, /Zapis do Hevy potwierdzony/);
      assert.equal(JSON.parse(readFileSync(historyPath, 'utf8')).r1.status, 'pending');
    } finally { blockConfirmation = false; rmSync(historyPath + '.tmp', { recursive: true }); }
  });

  await t.test('two tabs cannot overwrite the same backup while a push is in progress', async () => {
    const plan = await preview();
    let release!: () => void;
    waitForPut = new Promise<void>((resolve) => { release = resolve; });
    const arrived = new Promise<void>((resolve) => { notifyPut = resolve; });
    const first = request('/api/routines/r1/push', { fingerprint: plan.fingerprint, selected: [0], acknowledgeNoteLoss: true });
    await arrived;
    try {
      const second = await request('/api/routines/r1/push', { fingerprint: plan.fingerprint, selected: [1], acknowledgeNoteLoss: true });
      assert.equal(second.status, 409);
      assert.deepEqual(JSON.parse(readFileSync(historyPath, 'utf8')).r1.changes.map((c: any) => c.index), [0]);
    } finally { release(); waitForPut = undefined; notifyPut = undefined; }
    assert.equal((await first).status, 200);
  });

  await t.test('a broken history file still shows the plan but blocks push', async () => {
    const before = readFileSync(historyPath, 'utf8'), count = puts.length;
    writeFileSync(historyPath, '{');
    try {
      const plan = await preview();
      assert.equal(plan.history, null);
      assert.equal((await request('/api/routines/r1/push', { fingerprint: plan.fingerprint, selected: [0], acknowledgeNoteLoss: true })).status, 500);
      assert.equal(puts.length, count);
      assert.equal(readFileSync(historyPath, 'utf8'), '{');
    } finally { writeFileSync(historyPath, before); }
  });
});
