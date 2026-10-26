// Refreshes src/exercises-pl.json (exercise_template_id → Polish title) from the public Hevy web app bundle.
// The public API only returns English titles; the web app ships translations in one large JS chunk.
// Run: node scripts/update-pl-names.mjs
import { writeFileSync } from 'node:fs';

const BASE = 'https://hevy.com';
const get = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
};

const home = await get(BASE);
const buildId = home.match(/\/_next\/static\/([\w-]+)\/_buildManifest\.js/)?.[1];
if (!buildId) throw new Error('Nie znaleziono _buildManifest na hevy.com — zmienił się układ strony');
const manifest = await get(`${BASE}/_next/static/${buildId}/_buildManifest.js`);
// scripts in the HTML first (translations currently live in pages/_app), then the lazy-loaded ones
const chunks = [...new Set([...(home + manifest).matchAll(/static\/chunks\/[\w/.\-[\]]+\.js/g)].map((m) => m[0]))];

// JS string literal → text, without evaluating anything from the bundle
const unescape = (s) => s.replace(/\\x([0-9a-f]{2})|\\u([0-9a-f]{4})|\\(.)/gi, (_, x, u, c) => (x || u ? String.fromCharCode(parseInt(x || u, 16)) : c));

const names = {};
for (const chunk of chunks) {
  const js = await get(`${BASE}/_next/${chunk}`);
  if (!js.includes('"pl_title"')) continue;
  for (const obj of js.split(/(?="id":")/)) {
    const id = obj.match(/^"id":"([\w-]+)","title":/)?.[1];
    const pl = obj.match(/"pl_title":"((?:[^"\\]|\\.)*)"/)?.[1];
    if (id && pl) names[id] = unescape(pl);
  }
  break;
}
const count = Object.keys(names).length;
if (count < 100) throw new Error(`Znaleziono tylko ${count} nazw — format bundla Hevy się zmienił`);
writeFileSync(new URL('../src/exercises-pl.json', import.meta.url), JSON.stringify(names, null, 1) + '\n');
console.log(`Zapisano ${count} polskich nazw ćwiczeń`);
