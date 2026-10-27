import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { changes, expandWeights, kg, nextTarget, stalled, toPutBody, working, type HevyExercise, type Rule } from './engine.ts';
import { getRoutines, getTemplates, putRoutine, recentSessions } from './hevy.ts';

const PORT = Number(process.env.PORT ?? 3000);
const CONFIG_PATH = process.env.CONFIG_PATH ?? 'data/config.json';
const HISTORY_PATH = join(dirname(CONFIG_PATH), 'history.json');
const html = readFileSync(new URL('../public/index.html', import.meta.url));
// built-in exercises only; refresh with scripts/update-pl-names.mjs. Custom exercises keep the name you gave them.
const PL_NAMES: Record<string, string> = JSON.parse(readFileSync(new URL('./exercises-pl.json', import.meta.url), 'utf8'));
const STEPS = [1, 1.25, 2, 2.5, 5, 10];
const RANGES = [[3, 5], [4, 6], [5, 7], [6, 8], [6, 10], [8, 10], [8, 12], [10, 15], [10, 20], [12, 15], [15, 20]];
const EQUIPMENT_PL: Record<string, string> = { dumbbell: 'hantle', barbell: 'sztanga', machine: 'maszyna', kettlebell: 'kettlebell', plate: 'talerz' };

type Ranges = [number, number, number][];
type ExerciseConfig = Partial<Omit<Rule, 'weights'>> & { weights?: Ranges };
type Config = { defaults: Omit<Rule, 'weights'>; equipment: Record<string, Ranges>; exercises: Record<string, ExerciseConfig> };

const readRaw = (path = CONFIG_PATH) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {});
function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n');
  renameSync(path + '.tmp', path); // atomic: a crash mid-write can't leave broken JSON
}
function loadConfig(): Config {
  const c = readRaw();
  return {
    defaults: { min: 8, max: 12, maxRpe: 9, ...c.defaults },
    // only dumbbells get a default list; every other exercise gets its step picked in the UI
    equipment: { dumbbell: [[1, 10, 1], [12.5, 60, 2.5]], ...c.equipment },
    exercises: c.exercises ?? {},
  };
}
// patch keys: increment (number | null = default), range ([min, max] | null = default); absent keys are left alone
function saveExercise(id: string, patch: { increment?: number | null; range?: number[] | null; maxRpe?: number | null; exclude?: boolean }) {
  const c = readRaw();
  const own = { ...c.exercises?.[id] };
  if ('increment' in patch) {
    delete own.weights; // a step picked in the UI replaces a hand-written list
    if (patch.increment == null) delete own.increment; else own.increment = patch.increment;
  }
  if ('range' in patch) {
    if (patch.range == null) { delete own.min; delete own.max; } else [own.min, own.max] = patch.range;
  }
  if ('maxRpe' in patch) {
    if (patch.maxRpe == null) delete own.maxRpe; else own.maxRpe = patch.maxRpe;
  }
  if ('exclude' in patch) {
    if (patch.exclude) own.exclude = true; else delete own.exclude;
  }
  c.exercises = { ...c.exercises, [id]: own };
  if (!Object.keys(own).length) delete c.exercises[id];
  writeJson(CONFIG_PATH, c);
}

// precedence: config.json per exercise > rep range set in Hevy > defaults; weights: exercise list > exercise increment > equipment list
function ruleFor(cfg: Config, ex: HevyExercise, equipment: string | undefined) {
  const range = working(ex.sets).find((s) => s.rep_range?.start && s.rep_range?.end)?.rep_range;
  const own = cfg.exercises[ex.exercise_template_id] ?? {};
  const listed = equipment ? cfg.equipment[equipment] : undefined;
  const ranges = own.weights ?? (own.increment ? undefined : listed);
  const rule: Rule = { ...cfg.defaults, ...(range && { min: range.start!, max: range.end! }), ...own, weights: ranges ? expandWeights(ranges) : undefined };
  // what the step picker shows: current choice + what "default" means for this exercise
  const fallback = listed && `${EQUIPMENT_PL[equipment!] ?? equipment} ${listed.map(([a, b, s]) => `${kg(a)}–${kg(b)} co ${kg(s)}`).join(', ')}`;
  const step = { value: own.weights ? 'custom' : own.increment ?? '', fallback: fallback || null };
  const reps = { value: own.min && own.max ? `${own.min}-${own.max}` : '',
    fallback: range ? `${range.start}–${range.end} z Hevy` : `${cfg.defaults.min}–${cfg.defaults.max}` };
  const rpe = { value: own.maxRpe ?? '', fallback: String(cfg.defaults.maxRpe) };
  return { rule, step, reps, rpe };
}

async function fetchHevy() {
  const routines = await getRoutines();
  const ids = new Set(routines.flatMap((r) => r.exercises.map((e) => e.exercise_template_id)));
  const [history, templates] = await Promise.all([recentSessions(ids), getTemplates(ids)]);
  return { routines, history, templates };
}
// Settings changes reuse the last Hevy fetch (only config changed); page loads, refresh and push always fetch fresh.
let hevyData: ReturnType<typeof fetchHevy> | undefined;

async function buildPlan(fresh = true) {
  const cfg = loadConfig();
  if (fresh || !hevyData) hevyData = fetchHevy();
  let data;
  try { data = await hevyData; } catch (e) { hevyData = undefined; throw e; }
  const { routines, history, templates } = data;
  let saved: Record<string, any> = {};
  // a broken history file must not hide the plan; push still refuses to write over it
  try { saved = readRaw(HISTORY_PATH); } catch (e) { console.error(e); }
  return routines.map((routine) => {
    const exercises = routine.exercises.map((ex) => {
      const template = templates.get(ex.exercise_template_id);
      const { rule, step, reps, rpe } = ruleFor(cfg, ex, template?.equipment);
      const sessions = history.get(ex.exercise_template_id) ?? [];
      const result = nextTarget(sessions.map((s) => s.sets), rule);
      const loaded = sessions[0] && working(sessions[0].sets).some((s) => s.weight_kg != null);
      return { id: ex.exercise_template_id, title: PL_NAMES[ex.exercise_template_id] ?? ex.title, thumb: template?.thumbnail_url, current: working(ex.sets), last: sessions[0],
        rule: { min: rule.min, max: rule.max }, step: loaded ? step : null, reps: loaded ? reps : null, rpe,
        excluded: !!rule.exclude, stalled: result.action !== 'skip' && stalled(sessions.map((s) => s.sets)), recent: sessions,
        result, changed: changes(ex, result) };
    });
    const fingerprint = JSON.stringify([routine.updated_at, exercises.map((e) => [e.id, e.result])]);
    const previous = saved[routine.id];
    return { routine, results: exercises.map((e) => e.result), view: { id: routine.id, title: routine.title, fingerprint, exercises,
      history: previous ? { date: previous.date, status: previous.status, changes: previous.changes } : null } };
  });
}

const json = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
const readJson = async (req: IncomingMessage) => {
  const body = JSON.parse((await req.toArray()).join('') || '{}');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Oczekiwano obiektu JSON');
  return body;
};
const pushing = new Set<string>();

export const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
    if (req.method === 'GET' && (req.url === '/api/plan' || req.url === '/api/plan?cached=1'))
      return json(res, 200, { steps: STEPS, ranges: RANGES, routines: (await buildPlan(!req.url.endsWith('cached=1'))).map((p) => p.view) });
    const backup = req.method === 'GET' && req.url?.match(/^\/api\/routines\/([\w-]+)\/backup$/);
    if (backup) {
      const record = readRaw(HISTORY_PATH)[backup[1]];
      if (!record) return json(res, 404, { error: 'Brak kopii tego planu' });
      res.setHeader('content-disposition', `attachment; filename="hevy-${backup[1]}-backup.json"`);
      return json(res, 200, record);
    }

    // JSON content-type forces a CORS preflight, so other sites can't trigger writes from your browser
    if (req.method === 'POST' && req.headers['content-type'] !== 'application/json') return json(res, 415, { error: 'content-type must be application/json' });

    const settings = req.method === 'POST' && req.url?.match(/^\/api\/exercises\/([\w-]+)\/settings$/);
    if (settings) {
      const patch = await readJson(req);
      if ('increment' in patch && patch.increment !== null && !STEPS.includes(patch.increment))
        return json(res, 400, { error: `Skok musi być jednym z: ${STEPS.join(', ')}` });
      if ('range' in patch && patch.range !== null && (!Array.isArray(patch.range) || patch.range.length !== 2 || !RANGES.some(([a, b]) => patch.range[0] === a && patch.range[1] === b)))
        return json(res, 400, { error: 'Nieznany zakres powtórzeń' });
      if ('maxRpe' in patch && patch.maxRpe !== null && (!Number.isFinite(patch.maxRpe) || patch.maxRpe < 1 || patch.maxRpe > 10))
        return json(res, 400, { error: 'Limit RPE musi być liczbą od 1 do 10' });
      if ('exclude' in patch && typeof patch.exclude !== 'boolean') return json(res, 400, { error: 'Wykluczenie musi być wartością true lub false' });
      saveExercise(settings[1], { ...('increment' in patch && { increment: patch.increment }), ...('range' in patch && { range: patch.range }),
        ...('maxRpe' in patch && { maxRpe: patch.maxRpe }), ...('exclude' in patch && { exclude: patch.exclude }) });
      return json(res, 200, { ok: true });
    }

    const push = req.method === 'POST' && req.url?.match(/^\/api\/routines\/([\w-]+)\/push$/);
    if (push) {
      if (pushing.has(push[1])) return json(res, 409, { error: 'Wysyłka tego planu już trwa' });
      pushing.add(push[1]);
      try {
        // Recompute server-side and refuse if the preview no longer matches.
        const { fingerprint, acknowledgeNoteLoss, selected } = await readJson(req);
        const p = (await buildPlan()).find((x) => x.routine.id === push[1]);
        if (!p) return json(res, 404, { error: 'Nie ma takiej routine' });
        if (p.view.fingerprint !== fingerprint) return json(res, 409, { error: 'Plan zmienił się od podglądu — odśwież i sprawdź jeszcze raz' });
        if (!Array.isArray(selected) || new Set(selected).size !== selected.length || selected.some((i) => !Number.isInteger(i) || !p.view.exercises[i]?.changed))
          return json(res, 400, { error: 'Wybierz poprawne pozycje ćwiczeń ze zmianami' });
        const changed = selected.length;
        if (!changed) return json(res, 200, { changed: 0 });
        if (acknowledgeNoteLoss !== true)
          return json(res, 400, { error: 'Potwierdź, że zapis usuwa notatkę całej routine w Hevy. Notatki ćwiczeń zostają zachowane.' });
        const before = toPutBody(p.routine, []);
        const after = toPutBody(p.routine, p.results.map((r, i) => selected.includes(i) ? r : undefined));
        const record = { date: new Date().toISOString(), status: 'pending', before, after,
          changes: selected.map((i) => ({ index: i, title: p.view.exercises[i].title,
            before: working(before.routine.exercises[i].sets), after: working(after.routine.exercises[i].sets) })) };
        const save = () => writeJson(HISTORY_PATH, { ...readRaw(HISTORY_PATH), [p.routine.id]: record });
        try { save(); } catch (e) {
          console.error(e);
          return json(res, 500, { error: 'Nie udało się zapisać kopii poprzedniego planu. Nic nie wysłano do Hevy.' });
        }
        try {
          await putRoutine(p.routine.id, after);
        } catch (e) {
          console.error(e);
          record.status = 'unknown';
          try { save(); } catch (historyError) { console.error(historyError); }
          return json(res, 502, { error: 'Nie udało się potwierdzić wysyłki. Hevy mogło już zapisać zmiany — odśwież i sprawdź plan przed kolejną wysyłką.' });
        } finally {
          hevyData = undefined; // even a lost response may mean Hevy accepted the write
        }
        record.status = 'confirmed';
        try { save(); } catch (e) {
          console.error(e);
          return json(res, 200, { changed, historyWarning: 'Zapis do Hevy potwierdzony, ale nie udało się zaktualizować historii. Kopia sprzed zapisu została zachowana.' });
        }
        return json(res, 200, { changed });
      } finally { pushing.delete(push[1]); }
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: (e as Error).message });
  }
});

if (import.meta.main) server.listen(PORT, () => console.log(`hevy-companion: http://localhost:${PORT}`));
