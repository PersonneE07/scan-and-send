import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { blackAndWhite } from '../lib/image-pixels.ts';

function installWorker(t, worker) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', { value: worker, configurable: true, writable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'Worker', previous); else delete globalThis.Worker; });
}
const client = () => import(`../lib/pixel-worker-client.ts?test=${Math.random()}`);
function pixels(width, height) {
  return Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : (i * 37) % 256);
}
function browserWorkers(t) {
  let terminated = 0, messages = 0;
  class BrowserWorker {
    constructor(url) {
      this.worker = new NodeWorker(`
        const { parentPort } = await import('node:worker_threads');
        globalThis.self = { postMessage: (data, transfer) => parentPort.postMessage(data, transfer) };
        await import(${JSON.stringify(url.href)});
        parentPort.on('message', data => self.onmessage({ data }));
      `, { eval: true });
      this.worker.on('message', data => { messages++; this.onmessage?.({ data }); });
      this.worker.on('error', error => this.onerror?.(error));
    }
    postMessage(data) { this.worker.postMessage(data); }
    terminate() { terminated++; void this.worker.terminate(); }
  }
  installWorker(t, BrowserWorker);
  const count = () => terminated;
  count.messages = () => messages;
  return count;
}

test('actual worker produces the same black and white pixels without detaching the input', async t => {
  const terminated = browserWorkers(t), { processPixels } = await client();
  const input = pixels(80, 60), expected = input.slice();
  blackAndWhite(expected, 80, 60, 80);
  const actual = await processPixels({ kind: 'bw', pixels: input, width: 80, height: 60, contrast: 80 });
  assert.deepEqual(actual, expected);
  assert.equal(terminated.messages(), 1, "A real worker message, not fallback, supplied the result");
  assert.equal(input.byteLength, 80 * 60 * 4);
  assert.equal(terminated(), 1);
});
test('actual perspective worker preserves an uncropped image', async t => {
  const terminated = browserWorkers(t), { processPixels } = await client();
  const input = pixels(80, 60);
  const actual = await processPixels({ kind: 'perspective', pixels: input, width: 80, height: 60, outputWidth: 80, outputHeight: 60, rotation: 0, corners: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] });
  assert.deepEqual(actual, input);
  assert.equal(terminated.messages(), 1);
  assert.equal(terminated(), 1);
});
test('cancelling a large operation terminates the worker and never returns a stale result', async t => {
  const terminated = browserWorkers(t), { processPixels } = await client();
  const controller = new AbortController();
  const pending = processPixels({ kind: 'bw', pixels: pixels(2200, 1600), width: 2200, height: 1600, contrast: 50 }, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(terminated(), 1);
});
test('a worker startup error falls back safely and terminates the failed worker', async t => {
  let terminated = false;
  installWorker(t, class {
    postMessage() { queueMicrotask(() => this.onerror()); }
    terminate() { terminated = true; }
  });
  const { processPixels } = await client();
  const input = pixels(20, 20), expected = input.slice();
  blackAndWhite(expected, 20, 20, 50);
  assert.deepEqual(await processPixels({ kind: 'bw', pixels: input, width: 20, height: 20, contrast: 50 }), expected);
  assert.equal(terminated, true);
});
