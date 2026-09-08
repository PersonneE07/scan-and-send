import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { secureHtml } from '../scripts/secure-export.mjs';

test('export CSP precedes scripts and authorizes only known inline contents', () => {
  const script = 'window.example = "é";';
  const html = secureHtml(`<html><head><script>${script}</script><script src="/app.js"></script></head><body></body></html>`);
  const hash = createHash('sha256').update(script).digest('base64');
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script>'));
  assert.ok(html.includes(`script-src 'self' 'sha256-${hash}'`));
  assert.ok(!html.match(/script-src[^;]*unsafe-inline/));
  assert.ok(!html.includes('unsafe-eval'));
  assert.ok(html.includes("img-src 'self' blob: data:"));
  assert.throws(() => secureHtml('<body>invalid export</body>'));
});
