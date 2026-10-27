import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
const entry = () => ({ id: 'X', title: 'Test exercise', step: null, reps: null, rpe: { value: '', fallback: '9' }, excluded: false, stalled: false, recent: [], changed: true,
  current: [{ type: 'normal', weight_kg: 35, reps: 8 }], last: null,
  result: { action: 'increase', weight: 32.5, reps: [8], reason: 'Test reason' } });
const plan = (title = 'Test routine') => ({ steps: [], ranges: [], routines: [{ id: 'r1', title, fingerprint: 'f1', exercises: [entry()] }] });
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });

async function page(initialFetch = async (..._args: any[]) => response(plan())) {
  const nodes = new Map<string, any>();
  const node = (selector: string) => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', className: '', disabled: false,
      inert: false, events: {}, focus() {}, addEventListener(type: string, fn: any) { this.events[type] = fn; } });
    return nodes.get(selector);
  };
  let fetcher = initialFetch;
  const confirmations: string[] = [];
  const ctx = vm.createContext({ document: { querySelector: node }, CSS: { escape: (s: string) => s },
    fetch: (...args: any[]) => fetcher(...args),
    confirm: (message: string) => { confirmations.push(message); return true; } });
  await vm.runInContext(script, ctx);
  const button = { dataset: { push: '0' }, disabled: false, textContent: 'Wyślij 1 zmianę do Hevy' };
  return { ctx, node, button, confirmations, fetch: (fn: typeof fetcher) => { fetcher = fn; },
    run: (code: string) => vm.runInContext(code, ctx),
    push: () => node('#plan').events.click({ target: { closest: (selector: string) => selector === '[data-push]' ? button : null } }) };
}

test('load failure gives an error and refresh can recover', async () => {
  const p = await page(async () => { throw new Error('offline'); });
  assert.match(p.node('#status').innerHTML, /Błąd pobierania planu.*offline/);
  assert.match(p.node('#plan').textContent, /Odśwież/);
  p.fetch(async () => response(plan('Recovered')));
  await p.run('load()');
  assert.match(p.node('#plan').innerHTML, /Recovered/);
});

test('only the newest load may replace the plan or report errors', async () => {
  const p = await page();
  const pending: { resolve: (v: any) => void; reject: (e: Error) => void }[] = [];
  p.fetch(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  const old = p.run('load()'), latest = p.run('load()');
  pending[1].resolve(response(plan('Newest')));
  await latest;
  pending[0].resolve(response(plan('Old')));
  await old;
  assert.equal(p.run('data.routines[0].title'), 'Newest');
  const failing = p.run('load()'), succeeding = p.run('load()');
  pending[3].resolve(response(plan('Newest again')));
  await succeeding;
  pending[2].reject(new Error('stale failure'));
  await failing;
  assert.equal(p.run('data.routines[0].title'), 'Newest again');
  assert.doesNotMatch(p.node('#status').innerHTML, /stale failure/);
});

test('colours describe the actual change in Hevy, including mixed weights', async () => {
  const p = await page();
  p.ctx.entry = entry();
  assert.equal(p.run('state(entry)'), 'down');
  p.ctx.entry = { ...entry(), current: [{ weight_kg: 30 }], result: { ...entry().result, action: 'hold' } };
  assert.equal(p.run('state(entry)'), 'up');
  p.ctx.entry.current = [{ weight_kg: 30 }, { weight_kg: 35 }];
  assert.equal(p.run('state(entry)'), 'mixed');
  assert.match(p.node('#plan').innerHTML, /Teraz w Hevy: 8 × 35 kg/);
});

test('last session aligns working sets and excludes warmups and dropsets', async () => {
  const p = await page();
  p.ctx.entry = { ...entry(), last: { date: '2026-10-26', sets: [
    { type: 'warmup', weight_kg: 10, reps: 10 }, { type: 'normal', weight_kg: 30, reps: 10 },
    { type: 'dropset', weight_kg: 15, reps: 8 }, { type: 'failure', weight_kg: 30, reps: 9 },
  ] } };
  const row = p.run('row(entry, "r1:0")');
  const last = row.match(/<div class="last">([\s\S]*?)<\/div>/)[1];
  assert.equal((last.match(/<span>/g) ?? []).length, 2);
  assert.match(last, /10 × 30 kg/);
  assert.match(last, /9 × 30 kg/);
  assert.doesNotMatch(last, /15 kg|10 kg/);
});

test('cancelled confirmation sends nothing; accepted confirmation is sent to server', async () => {
  const p = await page();
  let posts = 0;
  p.fetch(async (_url, init) => {
    if (init?.method === 'POST') {
      posts++;
      assert.deepEqual(JSON.parse(init.body), { fingerprint: 'f1', acknowledgeNoteLoss: true, selected: [0] });
      return response({ changed: 1 });
    }
    return response(plan());
  });
  p.ctx.confirm = () => false;
  await p.push();
  assert.equal(posts, 0);
  p.ctx.confirm = (message: string) => { p.confirmations.push(message); return true; };
  await p.push();
  assert.equal(posts, 1);
  assert.match(p.confirmations[0], /usuwa notatkę całej routine/);
  assert.match(html, /<p class="msg">Uwaga:.*usuwa notatkę całej routine/);
  assert.match(p.node('#status').innerHTML, /zaktualizowano 1/);
});

test('ambiguous push failure unlocks refresh and explains the uncertain result', async () => {
  const p = await page();
  p.fetch(async () => { throw new Error('offline'); });
  await p.push();
  assert.equal(p.button.disabled, false);
  assert.equal(p.button.textContent, 'Wyślij 1 zmianę do Hevy');
  assert.equal(p.node('#refresh').disabled, false);
  assert.equal(p.node('#plan').inert, false);
  assert.match(p.node('#status').innerHTML, /Hevy mogło już zapisać zmiany/);
  assert.match(p.node('#plan').textContent, /Odśwież/);
});

test('successful push followed by failed refresh still reports confirmed save', async () => {
  const p = await page();
  p.fetch(async (_url, init) => {
    if (init?.method === 'POST') return response({ changed: 1 });
    throw new Error('offline');
  });
  await p.push();
  assert.match(p.node('#status').innerHTML, /Zapis potwierdzony/);
  assert.doesNotMatch(p.node('#status').innerHTML, /mogło już/);
  assert.equal(p.node('#refresh').disabled, false);
});

test('settings failure restores controls and reports that save was not confirmed', async () => {
  const p = await page();
  p.fetch(async () => { throw new Error('offline'); });
  const select = { dataset: { id: 'X', setting: 'increment' }, value: '5', disabled: false };
  await p.node('#plan').events.change({ target: { closest: (selector: string) => selector === '[data-setting]' ? select : null } });
  assert.equal(select.disabled, false);
  assert.equal(p.node('#refresh').disabled, false);
  assert.equal(p.node('#plan').inert, false);
  assert.match(p.node('#status').innerHTML, /Nie udało się potwierdzić zapisu ustawień/);
});

test('write in progress blocks other actions and invalidates an older read', async () => {
  const p = await page();
  let resolveRead: any, resolvePost: any, posts = 0;
  p.fetch(async (_url, init) => {
    if (init?.method === 'POST') { posts++; return new Promise((resolve) => { resolvePost = resolve; }); }
    return new Promise((resolve) => { resolveRead = resolve; });
  });
  const oldRead = p.run('load()');
  const push = p.push();
  assert.equal(p.node('#plan').inert, true);
  assert.equal(p.node('#refresh').disabled, true);
  await p.push();
  assert.equal(posts, 1);
  resolveRead(response(plan('Stale during write')));
  await oldRead;
  assert.notEqual(p.run('data.routines[0].title'), 'Stale during write');
  p.fetch(async () => response(plan('After save')));
  resolvePost(response({ changed: 1 }));
  await push;
  assert.equal(p.run('data.routines[0].title'), 'After save');
  assert.equal(p.node('#plan').inert, false);
});

test('selection distinguishes duplicate exercise IDs and sends only checked occurrences', async () => {
  const body = plan();
  body.routines[0].exercises.push({ ...entry(), title: 'Second occurrence' });
  const p = await page(async () => response(body));
  const choice = { dataset: { select: 'r1:0' }, checked: false };
  await p.node('#plan').events.change({ target: { closest: (selector: string) => selector === '[data-select]' ? choice : null } });
  assert.equal(p.run('selected(data.routines[0]).join(",")'), '1');
  assert.match(p.node('#plan').innerHTML, /Wybrano 1 z 2 zmian/);
  assert.match(p.node('#plan').innerHTML, /Nie zostanie wysłane/);
  let sent: any;
  p.fetch(async (_url, init) => {
    if (init?.method === 'POST') { sent = JSON.parse(init.body); return response({ changed: 1 }); }
    return response(body);
  });
  await p.push();
  assert.deepEqual(sent.selected, [1]);
  assert.equal(p.run('selected(data.routines[0]).join(",")'), '1');
  const next = JSON.parse(JSON.stringify(body));
  next.routines[0].fingerprint = 'new-preview';
  p.fetch(async () => response(next));
  await p.run('load()');
  assert.equal(p.run('selected(data.routines[0]).join(",")'), '0,1');
});

test('an empty selection disables sending and never opens confirmation', async () => {
  const p = await page();
  p.run('omitted.add("r1:0"); render()');
  await p.push();
  assert.equal(p.confirmations.length, 0);
  assert.match(p.node('#plan').innerHTML, /data-push="0" disabled>Wybierz zmiany/);
});

test('settings expose exclusion without history and send booleans, RPE and default reset', async () => {
  const p = await page();
  p.ctx.entry = { ...entry(), excluded: true };
  assert.match(p.run('settings(entry)'), /data-setting="exclude" checked/);
  assert.match(p.run('settings(entry)'), /data-setting="maxRpe"/);
  const sent: any[] = [];
  p.fetch(async (_url, init) => {
    if (init?.method === 'POST') { sent.push(JSON.parse(init.body)); return response({ ok: true }); }
    return response(plan());
  });
  for (const select of [
    { dataset: { id: 'X', setting: 'exclude' }, value: 'on', checked: true },
    { dataset: { id: 'X', setting: 'exclude' }, value: 'on', checked: false },
    { dataset: { id: 'X', setting: 'maxRpe' }, value: '7.5' },
    { dataset: { id: 'X', setting: 'maxRpe' }, value: '' },
  ]) await p.node('#plan').events.change({ target: { closest: (selector: string) => selector === '[data-setting]' ? select : null } });
  assert.deepEqual(sent, [{ exclude: true }, { exclude: false }, { maxRpe: 7.5 }, { maxRpe: null }]);
});

test('plateau displays three recent results without changing the proposed target', async () => {
  const p = await page();
  p.ctx.entry = { ...entry(), stalled: true, recent: ['2026-10-27', '2026-10-25', '2026-10-23'].map((date) =>
    ({ date, sets: [{ type: 'normal', weight_kg: 30, reps: 10 }] })) };
  p.run('open.add("r1:0")');
  const row = p.run('row(entry, "r1:0")');
  assert.match(row, /Brak poprawy w ostatnich 3 treningach/);
  assert.match(row, /Ostatnie 3 treningi/);
  assert.match(row, /27 paź: 10 × 30 kg/);
  assert.match(row, /8 × 32,5 kg/);
});

test('history labels uncertain writes honestly and provides an escaped summary and backup', async () => {
  const p = await page();
  p.ctx.routine = { id: 'r1', history: { date: '2026-10-27T12:00:00Z', status: 'unknown', changes: [
    { title: '<img onerror=bad()>', before: [{ weight_kg: 20, reps: 8 }], after: [{ weight_kg: 22.5, reps: 6 }] },
  ] } };
  const uncertain = p.run('pushHistory(routine)');
  assert.match(uncertain, /wynik niepotwierdzony/);
  assert.match(uncertain, /Wysyłano/);
  assert.doesNotMatch(uncertain, /Zapisano|<img/);
  assert.match(uncertain, /&#60;img/);
  assert.match(uncertain, /\/api\/routines\/r1\/backup/);
  p.ctx.routine.history.status = 'confirmed';
  assert.match(p.run('pushHistory(routine)'), /Zapisano/);
  p.fetch(async (_url, init) => init?.method === 'POST' ? response({ changed: 1, historyWarning: 'History could not be confirmed' }) : response(plan()));
  await p.push();
  assert.match(p.node('#status').innerHTML, /History could not be confirmed/);
});
