import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The export contains React hydration scripts. Authorize their exact contents,
// instead of allowing arbitrary inline JavaScript. Recomputed on every build.
export function secureHtml(html) {
  if (!html.includes('<head>')) throw new Error('Export is missing its head element');
  const hashes = new Set();
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\bsrc\s*=/i.test(attributes)) hashes.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  }
  const policy = [
    "default-src 'self'",
    `script-src 'self' ${[...hashes].join(' ')}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`);
}

async function secureDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await secureDirectory(path);
    else if (entry.name.endsWith('.html')) await writeFile(path, secureHtml(await readFile(path, 'utf8')));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await secureDirectory(resolve('dist/client'));
  console.log('Static HTML protected with per-build script hashes.');
}
