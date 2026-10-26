// Double progression, reverse-engineered from Periodize
// and aligned with arf.edu.pl/jak-progresowac-na-silowni. Pure — no I/O.

export type HevySet = {
  type: string;
  weight_kg: number | null;
  reps: number | null;
  rpe?: number | null;
  distance_meters?: number | null;
  duration_seconds?: number | null;
  custom_metric?: number | null;
  rep_range?: { start: number | null; end: number | null } | null;
};
export type HevyExercise = {
  exercise_template_id: string;
  title?: string;
  superset_id: number | null;
  rest_seconds: number | null;
  notes: string | null;
  sets: HevySet[];
};
export type Routine = { id: string; title: string; folder_id: number | null; exercises: HevyExercise[] };

// weights: every load available for this exercise (sorted); without it, `increment` is used; neither = user must pick a step.
export type Rule = { min: number; max: number; maxRpe: number; increment?: number; weights?: number[]; exclude?: boolean };
export type Result =
  | { action: 'increase' | 'hold' | 'decrease'; weight: number; reps: number[]; reason: string } // reps: one per working set of the last session
  | { action: 'skip'; reason: string };

const WORKING = new Set(['normal', 'failure']);
export const working = (sets: HevySet[]) => sets.filter((s) => WORKING.has(s.type));
export const kg = (w: number) => `${String(w).replace('.', ',')} kg`;
const fmt = (sets: HevySet[]) => sets.map((s) => `${s.reps} × ${kg(s.weight_kg!)}${s.rpe ? ` @RPE ${s.rpe}` : ''}`).join(', ');
const r2 = (x: number) => Math.round(x * 100) / 100;

// [[from, to, step], ...] → sorted list of available weights, e.g. [[1, 10, 1], [12.5, 50, 2.5]]
export function expandWeights(ranges: [number, number, number][]): number[] {
  const out = new Set<number>();
  for (const [from, to, step] of ranges) for (let w = from; w <= to + 1e-9; w += step) out.add(r2(w));
  return [...out].sort((a, b) => a - b);
}
const stepUp = (w: number, rule: Rule) => (rule.weights ? rule.weights.find((x) => x > w) : r2(w + rule.increment!));
const stepDown = (w: number, rule: Rule) =>
  rule.weights ? rule.weights.findLast((x) => x < w) : w - rule.increment! > 0 ? r2(w - rule.increment!) : undefined;
const PICK_STEP = 'Wybierz skok ciężaru dla tego ćwiczenia, żeby policzyć nowy ciężar.';

// sessions: this exercise's sets from past workouts, newest first.
export function nextTarget(sessions: HevySet[][], rule: Rule): Result {
  if (rule.exclude) return { action: 'skip', reason: 'Wykluczone w config.json' };
  const sets = working(sessions[0] ?? []);
  if (!sets.length) return { action: 'skip', reason: 'Brak historii tego ćwiczenia' };
  if (sets.some((s) => s.weight_kg == null || s.reps == null))
    return { action: 'skip', reason: 'Bez ciężaru (masa ciała / czas / dystans) — pomijam' };

  const weight = Math.max(...sets.map((s) => s.weight_kg!));
  const reps = sets.map((s) => s.reps!);
  const best = Math.max(...reps);
  const { min, max } = rule;
  const noStep = !rule.weights && !rule.increment;

  if (reps.every((r) => r >= max)) {
    const hardest = Math.max(...sets.map((s) => s.rpe ?? 0));
    if (hardest > rule.maxRpe)
      return { action: 'hold', weight, reps: sets.map(() => max),
        reason: `Górna granica zrobiona (${fmt(sets)}), ale RPE ${hardest} — za mały zapas. Powtórz ${kg(weight)}, zanim dołożysz.` };
    if (noStep) return { action: 'skip', reason: `Wszystkie serie ≥ ${max} (${fmt(sets)}) — czas na większy ciężar. ${PICK_STEP}` };
    const next = stepUp(weight, rule);
    if (next == null)
      return { action: 'hold', weight, reps: sets.map(() => max), reason: `Wszystkie serie ≥ ${max} (${fmt(sets)}), ale ${kg(weight)} to największy dostępny ciężar` };
    return { action: 'increase', weight: next, reps: sets.map(() => min),
      reason: `Wszystkie serie ≥ ${max} powt. (${fmt(sets)}) → ${kg(next)} (+${kg(r2(next - weight))}), wracasz do ${min} powt.` };
  }
  // each set progresses on its own: +1 rep, never below the range, never above it (12/10/8 → 12/11/9)
  const perSet = reps.map((r) => Math.min(max, Math.max(min, r + 1)));
  const goal = `cel ${perSet.join(' / ')} powt.`;

  if (best < min) {
    // one bad session is noise; two in a row at the same load means the last jump was too big
    const prev = working(sessions[1] ?? []);
    const prevBelow = prev.length > 0 && prev.every((s) => s.weight_kg === weight && s.reps != null) && Math.max(...prev.map((s) => s.reps!)) < min;
    if (prevBelow && noStep) return { action: 'skip', reason: `Drugi trening z rzędu poniżej ${min} powt. na ${kg(weight)} — trzeba cofnąć ciężar. ${PICK_STEP}` };
    const down = prevBelow ? stepDown(weight, rule) : undefined;
    if (down != null)
      return { action: 'decrease', weight: down, reps: sets.map(() => min),
        reason: `Drugi trening z rzędu poniżej ${min} powt. na ${kg(weight)} (${fmt(sets)}; wcześniej ${fmt(prev)}) → za duży skok, wracasz do ${kg(down)}` };
    return { action: 'hold', weight, reps: perSet,
      reason: `Poniżej zakresu (${fmt(sets)}) → zostaje ${kg(weight)}, ${goal} Jeśli znowu się nie uda, cofniemy ciężar.` };
  }

  return { action: 'hold', weight, reps: perSet,
    reason: `Nie wszystkie serie doszły do ${max} (${fmt(sets)}) → zostaje ${kg(weight)}, ${goal}` };
}

// target reps for the i-th working set of the routine; extra routine sets beyond last session reuse the last target
export const repsAt = (r: { reps: number[] }, i: number) => r.reps[Math.min(i, r.reps.length - 1)];

export function changes(ex: HevyExercise, r: Result): boolean {
  return r.action !== 'skip' && working(ex.sets).some((s, i) => s.weight_kg !== r.weight || s.reps !== repsAt(r, i));
}

// Builds the PUT /v1/routines/{id} body. The API replaces the whole exercise list, so every exercise is sent back.
// Only fields from PutRoutinesRequest* schemas — GET-only fields (index, title) are dropped.
export function toPutBody(routine: Routine, results: Map<string, Result>) {
  return {
    routine: {
      title: routine.title,
      folder_id: routine.folder_id,
      exercises: routine.exercises.map((ex) => {
        const r = results.get(ex.exercise_template_id);
        let w = 0; // working-set index
        return {
          exercise_template_id: ex.exercise_template_id,
          superset_id: ex.superset_id,
          rest_seconds: ex.rest_seconds,
          notes: ex.notes,
          sets: ex.sets.map((s) => {
            const set = { type: s.type, weight_kg: s.weight_kg, reps: s.reps, distance_meters: s.distance_meters ?? null,
              duration_seconds: s.duration_seconds ?? null, custom_metric: s.custom_metric ?? null, rep_range: s.rep_range ?? null };
            return r && r.action !== 'skip' && WORKING.has(s.type) ? { ...set, weight_kg: r.weight, reps: repsAt(r, w++) } : set;
          }),
        };
      }),
    },
  };
}
