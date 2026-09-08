import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { readDraft, writeDraft, validDraft } from '../lib/draft.ts';
const record = () => ({ version: 1, savedAt: Date.now(), name: 'Document', pages: [{ photo: new Blob(['png'], { type: 'image/png' }), settings: { mode: 'bw', rotation: 0, contrast: 50, edits: { crop: { unit: '%', x: 0, y: 0, width: 100, height: 100 }, scale: 1 } } }] });
test('draft validation rejects stale, malformed and oversized records', () => {
  const value = record();
  assert.equal(validDraft(value), true);
  for (const invalid of [null, {}, { ...value, version: 2 }, { ...value, pages: [] }, { ...value, pages: Array(21).fill(value.pages[0]) }, { ...value, savedAt: Date.now() - 8 * 86400000 }, { ...value, name: 'x'.repeat(91) }]) assert.equal(validDraft(invalid), false);
});
test('IndexedDB preserves blobs and serializes saves before deletion; expired drafts are removed', async () => {
  globalThis.indexedDB = new IDBFactory();
  try {
    const draft = record();
    await writeDraft(draft);
    assert.equal(await (await readDraft()).pages[0].photo.text(), 'png');
    const older = writeDraft(draft), newer = writeDraft({ ...draft, name: 'New' }), deletion = writeDraft(null);
    await Promise.all([older, newer, deletion]);
    assert.equal(await readDraft(), null);
    await writeDraft({ ...draft, savedAt: Date.now() - 8 * 86400000 });
    assert.equal(await readDraft(), null);
    assert.equal(await readDraft(), null);
  } finally { delete globalThis.indexedDB; }
});
