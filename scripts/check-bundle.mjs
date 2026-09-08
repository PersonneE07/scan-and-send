import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const root = resolve('dist/client');
const manifest = JSON.parse(await readFile(join(root, '.vite/manifest.json'), 'utf8'));
const html = await readFile(join(root, 'index.html'), 'utf8');
const byFile = new Map(Object.entries(manifest).map(([key, entry]) => [entry.file, key]));
const initial = new Set();
function visit(file) {
  if (initial.has(file)) return;
  initial.add(file);
  const entry = manifest[byFile.get(file)];
  for (const key of entry?.imports ?? []) visit(manifest[key].file);
}
for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="\/(?!\/)([^"?#]+\.js)"/g)) visit(match[1]);
assert.ok(initial.size > 0, 'The initial JavaScript graph must not be empty');
let gzip = 0;
for (const file of initial) gzip += gzipSync(await readFile(join(root, file))).length;
// The previous initial load was ~194 kB gzip. Keep future changes within budget.
assert.ok(gzip <= 185000, `Initial JavaScript exceeds 185 kB gzip: ${gzip} bytes`);
for (const key of ['components/image-editor.tsx', 'node_modules/pdf-lib/es/index.js']) {
  assert.ok(manifest[key]?.file, `Missing lazy chunk: ${key}`);
  assert.ok(!initial.has(manifest[key].file), `${key} must not load on the initial screen`);
}
const workers = await readdir(join(root, '_next/static/workers'));
assert.ok(workers.some(name => /^image\.worker-.*\.js$/.test(name)), 'The image worker must be emitted as a separate same-origin asset');
assert.ok(html.includes("worker-src 'self'"), 'CSP must explicitly allow same-origin workers');
console.log(`Initial JavaScript: ${(gzip / 1000).toFixed(1)} kB gzip (budget: 185 kB); editor, PDF and worker load on demand.`);
