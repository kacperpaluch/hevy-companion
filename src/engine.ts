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
  if (!Array.isArray(ranges) || !ranges.length) throw new Error('Lista ciężarów musi zawierać zakresy [od, do, krok]');
  const out = new Set<number>();
  let total = 0;
  for (const range of ranges) {
    if (!Array.isArray(range) || range.length !== 3 || !range.every(Number.isFinite))
      throw new Error('Zakres ciężarów musi zawierać trzy skończone liczby: [od, do, krok]');
    const [from, to, step] = range;
    if (from < 0 || to < from || step <= 0) throw new Error('Zakres ciężarów wymaga: 0 ≤ od ≤ do i krok > 0');
    const count = Math.floor((to - from + 1e-9) / step) + 1;
    total += count;
    if (!Number.isSafeInteger(total) || total > 10_000) throw new Error('Lista ciężarów może zawierać najwyżej 10000 pozycji');
    for (let i = 0; i < count; i++) {
      const weight = r2(from + i * step);
      if (!Number.isFinite(weight)) throw new Error('Ciężar jest zbyt duży');
      out.add(weight);
    }
  }
  return [...out].sort((a, b) => a - b);
}
const stepUp = (w: number, rule: Rule) => (rule.weights ? rule.weights.find((x) => x > w) : r2(w + rule.increment!));
const stepDown = (w: number, rule: Rule) =>
  rule.weights ? rule.weights.findLast((x) => x < w) : w - rule.increment! > 0 ? r2(w - rule.increment!) : undefined;
// Estimated one-rep max: Brzycki up to 10 reps, Epley above (they meet at 10); past 15 reps the estimate stops rising.
export function e1rm(weight: number, reps: number) {
  const r = Math.min(reps, 15);
  return r <= 10 ? (weight * 36) / (37 - r) : weight * (1 + r / 30);
}
export const weightFor = (oneRm: number, reps: number) => (reps <= 10 ? (oneRm * (37 - reps)) / 36 : oneRm / (1 + Math.min(reps, 15) / 30));
// Heaviest load you can actually set at or below `x`, starting from the current weight when only a step is known.
export const snapDown = (x: number, weight: number, rule: Rule) =>
  rule.weights ? rule.weights.findLast((w) => w <= x) : r2(weight + Math.floor((x - weight) / rule.increment! + 1e-9) * rule.increment!);
const PICK_STEP ='Wybierz skok ciężaru dla tego ćwiczenia, żeby policzyć nowy ciężar.';

// sessions: this exercise's sets from past workouts, newest first.
export function nextTarget(sessions: HevySet[][], rule: Rule): Result {
  if (rule.exclude) return { action: 'skip', reason: 'Wykluczone z progresji w ustawieniach' };
  const sets = working(sessions[0] ?? []);
  if (!sets.length) return { action: 'skip', reason: 'Brak historii tego ćwiczenia' };
  if (sets.some((s) => s.weight_kg == null || s.reps == null))
    return { action: 'skip', reason: 'Bez ciężaru (masa ciała / czas / dystans) — pomijam' };

  const weight = Math.max(...sets.map((s) => s.weight_kg!));
  const reps = sets.map((s) => s.reps!);
  const best = Math.max(...reps);
  const { min, max } = rule;
  const noStep = !rule.weights && !rule.increment;

  // RPE turns reps in reserve into reps (10 @RPE 8 counts as 12); no RPE = no reserve, like Gravl's default "hard"
  const reserve = (s: HevySet) => (s.rpe ? Math.max(0, 10 - s.rpe) : 0);
  const effective = (s: HevySet) => s.reps! + reserve(s);
  // a set dropped to a lighter load doesn't count as done at the working weight
  if (sets.every((s) => s.weight_kg === weight && effective(s) >= max)) {
    const hardest = Math.max(...sets.map((s) => s.rpe ?? 0));
    if (hardest > rule.maxRpe)
      return { action: 'hold', weight, reps: sets.map(() => max),
        reason: `Górna granica zrobiona (${fmt(sets)}), ale RPE ${hardest} — za mały zapas. Powtórz ${kg(weight)}, zanim dołożysz.` };
    if (noStep) return { action: 'skip', reason: `Wszystkie serie ≥ ${max} (${fmt(sets)}) — czas na większy ciężar. ${PICK_STEP}` };
    const next = stepUp(weight, rule);
    if (next == null)
      return { action: 'hold', weight, reps: sets.map(() => max), reason: `Wszystkie serie ≥ ${max} (${fmt(sets)}), ale ${kg(weight)} to największy dostępny ciężar` };
    // only a reported reserve can jump past one step: e1RM with reserve, lifted by RPE 10% at most, sized for min + 2 reps
    let to = next, why = '';
    if (sets.some((s) => reserve(s) > 0)) {
      const raw = Math.max(...sets.map((s) => e1rm(weight, s.reps!)));
      const est = Math.min(Math.max(...sets.map((s) => e1rm(weight, effective(s)))), raw * 1.1);
      const fit = snapDown(weightFor(est, min + 2), weight, rule);
      if (fit != null && fit > next) to = fit;
      why = `; licząc zapas z RPE: ${sets.map((s) => String(effective(s)).replace('.', ',')).join(' / ')} powt.; e1RM ≈ ${kg(Math.round(est))}`;
    }
    return { action: 'increase', weight: to, reps: sets.map(() => min),
      reason: `Wszystkie serie ≥ ${max} powt. (${fmt(sets)}${why}) → ${kg(to)} (+${kg(r2(to - weight))}), wracasz do ${min} powt.` };
  }
  // a set at a lighter load says nothing about the working weight: count it as the weakest set done at that weight
  const floorAtW = Math.min(...sets.filter((s) => s.weight_kg === weight).map((s) => s.reps!));
  const ladder = sets.map((s) => (s.weight_kg === weight ? s.reps! : floorAtW));
  const lighter = sets.some((s) => s.weight_kg !== weight) ? `; lżejsze serie liczę jak najsłabszą na ${kg(weight)}` : '';
  // +1 rep on the weakest set only (12/10/8 → 12/10/9): backtest on real history hit this 4× more often than +1 on every set
  const weakest = ladder.indexOf(Math.min(...ladder));
  const perSet = ladder.map((r, i) => Math.min(max, Math.max(min, i === weakest ? r + 1 : r)));
  const plusOne = perSet[weakest] === ladder[weakest] + 1 ? ` (+1 powt. w serii ${weakest + 1})` : '';
  const goal = `cel ${perSet.join(' / ')} powt.${plusOne}`;

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
      reason: `Poniżej zakresu (${fmt(sets)}${lighter}) → zostaje ${kg(weight)}, ${goal} Jeśli znowu się nie uda, cofniemy ciężar.` };
  }

  return { action: 'hold', weight, reps: perSet,
    reason: `Nie wszystkie serie na ${kg(weight)} doszły do ${max} (${fmt(sets)}${lighter}) → zostaje ${kg(weight)}, ${goal}` };
}

// target reps for the i-th working set of the routine; extra routine sets beyond last session reuse the last target
export const repsAt = (r: { reps: number[] }, i: number) => r.reps[Math.min(i, r.reps.length - 1)];

export function changes(ex: HevyExercise, r: Result): boolean {
  return r.action !== 'skip' && working(ex.sets).some((s, i) => s.weight_kg !== r.weight || s.reps !== repsAt(r, i));
}

// Compare like-for-like sets; a change in load or set count is not evidence of a plateau.
export function stalled(sessions: HevySet[][]): boolean {
  if (sessions.length < 3) return false;
  const [last, prev, older] = sessions.slice(0, 3).map(working);
  return last.length > 0 && last.length === prev.length && prev.length === older.length && last.every((s, i) =>
    s.weight_kg != null && s.weight_kg === prev[i].weight_kg && s.weight_kg === older[i].weight_kg &&
    s.reps != null && prev[i].reps != null && older[i].reps != null && s.reps <= prev[i].reps! && prev[i].reps! <= older[i].reps!);
}

// Builds the PUT /v1/routines/{id} body. The API replaces the whole exercise list, so every exercise is sent back.
// Only fields from PutRoutinesRequest* schemas — GET-only fields (index, title) are dropped.
export function toPutBody(routine: Routine, results: (Result | undefined)[]) {
  return {
    routine: {
      title: routine.title,
      folder_id: routine.folder_id,
      exercises: routine.exercises.map((ex, i) => {
        const r = results[i];
        let w = 0; // working-set index
        return {
          exercise_template_id: ex.exercise_template_id,
          superset_id: ex.superset_id,
          rest_seconds: ex.rest_seconds,
          notes: ex.notes,
          sets: ex.sets.map((s) => {
            const set = { type: s.type, weight_kg: s.weight_kg, reps: s.reps, distance_meters: s.distance_meters ?? null,
              duration_seconds: s.duration_seconds ?? null, custom_metric: s.custom_metric ?? null,
              ...(s.rep_range && { rep_range: s.rep_range }) }; // Hevy rejects rep_range: null despite the spec
            return r && r.action !== 'skip' && WORKING.has(s.type) ? { ...set, weight_kg: r.weight, reps: repsAt(r, w++) } : set;
          }),
        };
      }),
    },
  };
}
