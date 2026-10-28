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
