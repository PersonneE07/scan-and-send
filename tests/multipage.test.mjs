/* eslint-disable @typescript-eslint/no-deprecated -- Test doubles intentionally replace browser APIs; merged DOM/Worker overloads flag these fixture properties. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { IDBFactory } from 'fake-indexeddb';
import { readDraft } from '../lib/draft.ts';
import { create, act } from 'react-test-renderer';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PDFDocument, PDFName, PDFDict, PDFRawStream } from 'pdf-lib';
import { combinePages } from '../lib/document.ts';

const require = createRequire(import.meta.url);
// Render only the state hook, without DOM/browser inspection. Decode through a
// real canvas while replacing the browser-only Image constructor in this test.
let source = await readFile(new URL('../hooks/use-scanner.ts', import.meta.url), 'utf8');
source = source.replace("from 'react'", `from '${pathToFileURL(require.resolve('react')).href}'`)
  .replace('normalizePhoto, ', '')
  .replace("from '@/lib/i18n'", `from '${new URL('../lib/i18n.ts', import.meta.url).href}'`)
  .replace("from '@/lib/document'", `from '${new URL('../lib/document.ts', import.meta.url).href}'`);
for (const path of ['./use-page-collection.ts', './use-local-draft.ts', './use-pdf-export.ts', '../lib/scan-page.ts']) {
  source = source.replace(`from '${path}'`, `from '${new URL(path, new URL('../hooks/use-scanner.ts', import.meta.url)).href}'`);
}
source = 'const normalizePhoto = (...args) => globalThis.scannerTestDecode(...args);\n' + stripTypeScriptTypes(source);
const { useScanner } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const pause = () => new Promise(resolve => setTimeout(resolve, 10));

function photo(color, name = 'photo.png') {
  const canvas = createCanvas(80, 60), context = canvas.getContext('2d');
  context.fillStyle = color; context.fillRect(0, 0, 80, 60);
  return new File([canvas.toBuffer('image/png')], name, { type: 'image/png' });
}

async function harness(t, locale = 'fr') {
  const owned = new Set(), createURL = URL.createObjectURL.bind(URL), revokeURL = URL.revokeObjectURL.bind(URL);
  t.mock.method(URL, 'createObjectURL', blob => { const url = createURL(blob); owned.add(url); return url; });
  t.mock.method(URL, 'revokeObjectURL', url => { owned.delete(url); revokeURL(url); });
  const previous = { document: globalThis.document, requestAnimationFrame: globalThis.requestAnimationFrame, scannerTestDecode: globalThis.scannerTestDecode, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.document = { createElement: () => createCanvas(1, 1) };
  globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.scannerTestDecode = async (file, signal) => {
    signal?.throwIfAborted();
    const image = await loadImage(Buffer.from(await file.arrayBuffer()));
    signal?.throwIfAborted();
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas;
  };
  let api, root;
  function Probe() { const value = useScanner(locale); React.useLayoutEffect(() => { api = value; }); return null; }
  await act(async () => { root = create(React.createElement(Probe)); });
  t.after(async () => {
    await act(async () => root.unmount());
    assert.equal(owned.size, 0, 'Every page/editor/document URL is released after unmount');
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  return {
    get api() { return api; },
    async remount() { await act(async () => root.unmount()); await act(async () => { root = create(React.createElement(Probe)); }); await act(pause); },
    async language(next) { locale = next; await act(async () => root.update(React.createElement(Probe))); },
    async run(action) {
      await act(async () => { await action(api); await pause(); });
      const deadline = Date.now() + 5000;
      while (api.busy && Date.now() < deadline) await act(pause);
      assert.equal(api.busy, false, 'Processing should finish');
    },
  };
}

async function images(api) {
  assert.ok(api.pdf, api.error || 'A complete PDF must be available');
  const document = await PDFDocument.load(await api.pdf.file.arrayBuffer());
  return document.getPages().map(page => {
    const resources = page.node.Resources().lookup(PDFName.of('XObject'), PDFDict);
    return document.context.lookup(resources.entries()[0][1], PDFRawStream);
  });
}

async function assertColors(api, colors) {
  const streams = await images(api); assert.equal(streams.length, colors.length);
  for (let i = 0; i < streams.length; i++) {
    const image = await loadImage(Buffer.from(streams[i].getContents()));
    const canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const actual = context.getImageData(10, 10, 1, 1).data;
    assert.ok(colors[i].every((value, channel) => Math.abs(value - actual[channel]) < 5), `Page ${i + 1} must retain its own image and position`);
  }
}

test('multiple pages preserve order, individual edits, replacement and deletion in the actual PDF', async t => {
  const h = await harness(t);
  await h.run(api => api.setMode('color'));
  await h.run(api => api.loadFiles([photo('red'), photo('blue')]));
  assert.equal(h.api.pages.length, 2); assert.equal(h.api.activeIndex, 1);
  await assertColors(h.api, [[255, 0, 0], [0, 0, 255]]);
  const firstId = h.api.pages[0].id, secondId = h.api.pages[1].id;
  const untouched = Buffer.from((await images(h.api))[1].getContents());
  await h.run(api => api.selectPage(firstId));
  await h.run(api => api.openEditor());
  await h.run(api => api.applyEdits({ crop: { unit: '%', x: 0, y: 0, width: 50, height: 100 }, scale: 1 }));
  let streams = await images(h.api);
  assert.equal(streams[0].dict.get(PDFName.of('Width')).asNumber(), 40);
  assert.deepEqual(Buffer.from(streams[1].getContents()), untouched);
  await h.run(api => api.setMode('bw'));
  await h.run(api => { api.setContrast(80); api.commitContrast(); });
  await h.run(api => api.selectPage(secondId));
  assert.equal(h.api.mode, 'color'); assert.equal(h.api.contrast, 50);
  await h.run(api => api.selectPage(firstId));
  assert.equal(h.api.mode, 'bw'); assert.equal(h.api.contrast, 80);
  streams = await images(h.api);
  assert.equal(streams[0].dict.get(PDFName.of('Width')).asNumber(), 40);
  await h.run(api => api.clearPhoto());
  assert.equal(h.api.pages.length, 1);
  await assertColors(h.api, [[0, 0, 255]]);
  await h.run(api => api.loadFiles([photo('lime'), photo('red')]));
  await h.run(api => api.selectPage(secondId));
  await h.run(api => api.loadFiles([photo('yellow')], true));
  assert.equal(h.api.pages.length, 3); assert.equal(h.api.activeIndex, 0);
  await assertColors(h.api, [[255, 255, 0], [0, 255, 0], [255, 0, 0]]);
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let shared;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { canShare: () => true, share: async payload => { shared = payload; } } });
  try {
    await h.run(api => api.share());
    const sent = await PDFDocument.load(await shared.files[0].arrayBuffer());
    assert.equal(sent.getPageCount(), 3, 'Native email sharing receives the complete document');
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else delete globalThis.navigator;
  }
});

test('cancelled or failed imports keep the existing document and never insert partial pages', async t => {
  const h = await harness(t);
  await h.run(api => api.setMode('color'));
  await h.run(api => api.loadFiles([photo('blue')]));
  const originalId = h.api.pages[0].id, originalBytes = Buffer.from(await h.api.pdf.file.arrayBuffer());
  const decode = globalThis.scannerTestDecode;
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  globalThis.scannerTestDecode = async (...args) => { await gate; return decode(...args); };
  let pending;
  await act(async () => { pending = h.api.loadFiles([photo('red')]); await pause(); });
  assert.equal(h.api.loading, true); assert.equal(h.api.pdf, null);
  await h.run(api => api.clearPhoto());
  resume(); await act(async () => { await pending; });
  assert.equal(h.api.pages.length, 1); assert.equal(h.api.pages[0].id, originalId);
  assert.deepEqual(Buffer.from(await h.api.pdf.file.arrayBuffer()), originalBytes);
  globalThis.scannerTestDecode = decode;
  await h.run(api => api.loadFiles([photo('red'), new File(['invalid'], 'broken.png', { type: 'image/png' })]));
  assert.ok(h.api.error); assert.equal(h.api.pages.length, 1);
  assert.deepEqual(Buffer.from(await h.api.pdf.file.arrayBuffer()), originalBytes);
  await h.run(api => api.clearPhoto());
  assert.equal(h.api.pages.length, 0); assert.equal(h.api.pdf, null); assert.equal(h.api.source, false);
});

test('combining pages rejects an empty document and respects cancellation', async () => {
  await assert.rejects(combinePages([]), /page/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(combinePages([new Blob() ], controller.signal), { name: 'AbortError' });
});


test('oversized page batches are rejected without modifying the current PDF', async t => {
  const h = await harness(t);
  await h.run(api => api.loadFiles([photo('red')]));
  const before = h.api.pdf.file;
  await h.run(api => api.loadFiles(Array.from({ length: 20 }, () => photo('blue'))));
  assert.match(h.api.error, /20 pages/);
  assert.equal(h.api.pages.length, 1);
  assert.equal(h.api.pdf.file, before);
  await h.run(api => api.loadFiles([{ size: 101 * 1024 * 1024 }]));
  assert.match(h.api.error, /100 Mo/);
  assert.equal(h.api.pdf.file, before);
});


test('language changes preserve pages and custom filenames and translate feedback', async t => {
  const h = await harness(t, 'en');
  assert.equal(h.api.name, 'My document');
  await h.run(api => api.loadFiles([photo('blue')]));
  const before = h.api.pdf.file;
  const preview = h.api.preview;
  assert.equal(before.name, 'My document.pdf');
  await h.language('fr');
  assert.equal(h.api.name, 'Mon document');
  assert.equal(h.api.preview, preview);
  assert.equal(h.api.pages.length, 1);
  assert.deepEqual(await h.api.pdf.file.arrayBuffer(), await before.arrayBuffer());
  await h.run(api => api.setName('Invoice été'));
  await h.language('en');
  assert.equal(h.api.name, 'Invoice été');
  await h.run(api => api.loadFiles(Array.from({ length: 20 }, () => photo('red'))));
  assert.equal(h.api.error, 'A document can contain up to 20 pages.');
  await h.language('fr');
  assert.match(h.api.error, /20 pages/);
  assert.equal(h.api.pdf.file.name, 'Invoice été.pdf');
});


test('undo restores deleted and replaced pages and reordering changes the actual PDF', async t => {
  const h = await harness(t);
  await h.run(api => api.setMode('color'));
  await h.run(api => api.loadFiles([photo('red'), photo('blue')]));
  await h.run(api => api.setName('Two pages'));
  await h.run(api => api.movePage(-1));
  assert.equal(h.api.activeIndex, 0);
  await assertColors(h.api, [[0, 0, 255], [255, 0, 0]]);
  await h.run(api => api.loadFiles([photo('lime')], true));
  await assertColors(h.api, [[0, 255, 0], [255, 0, 0]]);
  await h.run(api => api.undoLast());
  await assertColors(h.api, [[0, 0, 255], [255, 0, 0]]);
  assert.equal(h.api.canUndo, false);
  await h.run(api => api.clearPhoto());
  await h.run(api => api.undoLast());
  await assertColors(h.api, [[0, 0, 255], [255, 0, 0]]);
  await h.run(api => api.clearPhoto());
  await h.run(api => api.clearPhoto());
  assert.equal(h.api.source, false);
  await h.run(api => api.undoLast());
  await assertColors(h.api, [[255, 0, 0]]);
  assert.equal(h.api.name, 'Two pages');
});

test('a local draft restores page order, edits and filename after remount, or can be discarded', async t => {
  globalThis.indexedDB = new IDBFactory();
  t.after(() => { delete globalThis.indexedDB; });
  const h = await harness(t);
  await h.run(api => api.setMode('color'));
  await h.run(api => api.loadFiles([photo('red'), photo('blue')]));
  await h.run(api => api.movePage(-1));
  await h.run(api => api.setName('Saved draft'));
  await h.run(api => api.openEditor());
  await h.run(api => api.applyEdits({ crop: { unit: '%', x: 0, y: 0, width: 50, height: 100 }, scale: 1 }));
  const saved = await readDraft();
  assert.equal(saved.name, 'Saved draft');
  assert.equal(saved.pages.length, 2);
  await h.remount();
  assert.ok(h.api.pendingDraft);
  assert.equal(h.api.source, false, 'Restoration requires an explicit choice');
  await h.run(api => api.restoreDraft());
  assert.equal(h.api.pendingDraft, null);
  assert.equal(h.api.name, 'Saved draft');
  await assertColors(h.api, [[0, 0, 255], [255, 0, 0]]);
  assert.equal((await images(h.api))[0].dict.get(PDFName.of('Width')).asNumber(), 40);
  await h.remount();
  await h.run(api => api.discardDraft());
  assert.equal(await readDraft(), null);
  assert.equal(h.api.pendingDraft, null);
  assert.equal(h.api.source, false);
});

test('storage failure does not prevent PDF export', async t => {
  const h = await harness(t);
  await h.run(api => api.loadFiles([photo('blue')]));
  assert.ok(h.api.pdf);
  assert.equal(h.api.draftStatus, 'temporary');
});
