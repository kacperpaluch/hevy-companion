import { working, type HevySet, type Routine } from './engine.ts';

const BASE = 'https://api.hevyapp.com/v1';
const KEY = process.env.HEVY_API_KEY;
if (!KEY) throw new Error('Brak HEVY_API_KEY w środowisku (.env)');

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, { ...init, headers: { 'api-key': KEY!, 'content-type': 'application/json' } });
  if (!res.ok) throw new Error(`Hevy ${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function getRoutines(): Promise<(Routine & { updated_at: string })[]> {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await call(`/routines?page=${page}&pageSize=10`);
    out.push(...r.routines);
    if (page >= r.page_count) return out;
  }
}

export type Session = { date: string; workout: string; sets: HevySet[] };

// Walks workouts newest-first and keeps the latest `keep` sessions of each wanted exercise.
// shortcut: stops after 30 pages (300 workouts); exercises not done since then show "no history".
export async function recentSessions(ids: Set<string>, keep = 3, maxPages = 30): Promise<Map<string, Session[]>> {
  const out = new Map<string, Session[]>([...ids].map((id) => [id, []]));
  for (let page = 1; page <= maxPages; page++) {
    const r = await call(`/workouts?page=${page}&pageSize=10`);
    for (const w of r.workouts) {
      const seen = new Set<string>(); // same exercise twice in one workout counts once
      for (const e of w.exercises) {
        const list = out.get(e.exercise_template_id);
        if (list && list.length < keep && !seen.has(e.exercise_template_id) && working(e.sets).length) {
          seen.add(e.exercise_template_id);
          list.push({ date: w.start_time, workout: w.title, sets: e.sets });
        }
      }
    }
    if ([...out.values()].every((l) => l.length >= keep) || page >= r.page_count) break;
  }
  return out;
}

export type Template = { equipment: string; thumbnail_url: string | null };

// Exercise templates (equipment, thumbnail) don't change, so they're cached for the process lifetime.
const templates = new Map<string, Template>();
export async function getTemplates(ids: Set<string>): Promise<Map<string, Template>> {
  await Promise.all([...ids].filter((id) => !templates.has(id)).map(async (id) =>
    templates.set(id, await call(`/exercise_templates/${encodeURIComponent(id)}`))));
  return templates;
}

export const putRoutine = (id: string, body: unknown) =>
  call(`/routines/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });
