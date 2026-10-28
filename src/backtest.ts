// Replays the engine over past sessions: what it would have advised after each one vs what was done next.
// Pure part only; the network part runs when this file is started directly.
import { nextTarget, repsAt, working, type HevySet, type Result, type Rule } from './engine.ts';

// '=' on target, '↑' heavier than advised, '↓' lighter or short of the reps, '·' no advice (skip)
export type Mark = '=' | '↑' | '↓' | '·';
export type Step = { sets: HevySet[]; result: Result; next?: HevySet[]; mark?: Mark };

function mark(r: Result, next: HevySet[]): Mark {
  const sets = working(next);
  if (r.action === 'skip' || !sets.length) return '·';
  if (sets.some((s) => s.weight_kg != null && s.weight_kg > r.weight)) return '↑';
  return sets.some((s, i) => (s.weight_kg ?? 0) < r.weight || (s.reps ?? 0) < repsAt(r, i)) ? '↓' : '=';
}

// sessions: one exercise's sets, newest first (as recentSessions returns them). Steps come back oldest first.
export function replay(sessions: HevySet[][], rule: Rule): Step[] {
  return sessions.map((sets, i): Step => {
    const result = nextTarget(sessions.slice(i), rule);
    const next = sessions[i - 1];
    return next ? { sets, result, next, mark: mark(result, next) } : { sets, result };
  }).reverse();
}

export function summary(steps: Step[]): Record<Mark, number> {
  const out = { '=': 0, '↑': 0, '↓': 0, '·': 0 };
  for (const s of steps) if (s.mark) out[s.mark]++;
  return out;
}

const num = (w: number) => String(w).replace('.', ',');
const sets = (list: HevySet[]) =>
  working(list).map((s) => `${s.weight_kg == null ? '-' : num(s.weight_kg)}×${s.reps ?? '-'}${s.rpe ? `@${num(s.rpe)}` : ''}`).join(' ');
const advice = (r: Result) => (r.action === 'skip' ? 'skip' : `${r.action} ${num(r.weight)} kg × ${r.reps.join('/')}`);
const counts = (c: Record<Mark, number>) => `= ${c['=']} · ↑ ${c['↑']} · ↓ ${c['↓']} · pominięte ${c['·']}`;

// Plain text, no dates or randomness, so two runs can be compared with diff.
export function report(title: string, rule: Rule, steps: Step[]): string {
  const step = rule.increment ? `co ${num(rule.increment)} kg` : rule.weights ? 'lista ciężarów' : 'bez skoku';
  const lines = steps.map((x) =>
    `  ${sets(x.sets).padEnd(22)} → ${advice(x.result).padEnd(26)}${x.next ? ` → ${sets(x.next).padEnd(22)} ${x.mark}` : ''}`.trimEnd());
  return [`## ${title} · ${rule.min}–${rule.max} · ${step}`, ...(steps.length ? lines : ['  brak historii']),
    ...(steps.length ? [`  podsumowanie: ${counts(summary(steps))}`] : [])].join('\n');
}

// Read-only: fetches from Hevy, never writes.
if (import.meta.main) {
  const { getRoutines, getTemplates, recentSessions } = await import('./hevy.ts');
  const { loadConfig, ruleFor, PL_NAMES } = await import('./server.ts');
  const cfg = loadConfig();
  const routines = await getRoutines();
  const ids = new Set(routines.flatMap((r) => r.exercises.map((e) => e.exercise_template_id)));
  const [history, templates] = await Promise.all([recentSessions(ids, 50), getTemplates(ids)]);
  const all: Step[] = [];
  for (const routine of routines) {
    console.log(`# ${routine.title}\n`);
    for (const ex of routine.exercises) {
      const id = ex.exercise_template_id;
      const { rule } = ruleFor(cfg, ex, templates.get(id)?.equipment);
      const steps = replay((history.get(id) ?? []).map((s) => s.sets), rule);
      all.push(...steps);
      console.log(report(PL_NAMES[id] ?? ex.title ?? id, rule, steps) + '\n');
    }
  }
  console.log(`RAZEM: ${counts(summary(all))}`);
}
