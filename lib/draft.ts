import { imageGeometry } from './image-geometry.ts';
import type { Settings } from './scan-page.ts';
export type PageSettings = Settings;
export type Draft = { version: 1; savedAt: number; name: string | null; pages: { photo: Blob; settings: PageSettings }[] };
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export function validDraft(value: unknown): value is Draft {
  if (!value || typeof value !== 'object') return false;
  const d = value as Draft;
  try {
  return d.version === 1 && Number.isFinite(d.savedAt) && d.savedAt <= Date.now() && Date.now() - d.savedAt < MAX_AGE &&
    (d.name === null || (typeof d.name === 'string' && d.name.length <= 90)) && Array.isArray(d.pages) && d.pages.length > 0 && d.pages.length <= 20 &&
    d.pages.every(p => p?.photo instanceof Blob && p.photo.size > 0 && p.photo.type === 'image/png' && p.settings &&
      ['bw', 'color'].includes(p.settings.mode) && [0, 90, 180, 270].includes(p.settings.rotation) &&
      Number.isInteger(p.settings.contrast) && p.settings.contrast >= 0 && p.settings.contrast <= 100 && p.settings.edits &&
      !!imageGeometry(2200, 2200, p.settings.rotation, p.settings.edits)) &&
    d.pages.reduce((sum, p) => sum + p.photo.size, 0) <= 100 * 1024 * 1024;
  } catch { return false; }
}
// Transactions are queued so an older save cannot overwrite a later deletion.
let queue: Promise<unknown> = Promise.resolve();
function transaction<T>(action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const run = queue.catch(() => {}).then(() => new Promise<T>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Local storage unavailable')); return; }
    let db: IDBDatabase | undefined;
    let tx: IDBTransaction | undefined;
    let finished = false;
    const finish = (error?: unknown, result?: T) => {
      if (finished) return;
      finished = true; clearTimeout(timer); db?.close();
      if (error) reject(error); else resolve(result as T);
    };
    const timer = setTimeout(() => { tx?.abort(); finish(new Error('Local storage timeout')); }, 5000);
    const open = indexedDB.open('scan-and-send.draft', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('draft');
    open.onerror = () => finish(open.error);
    open.onblocked = () => finish(new Error('Local storage blocked'));
    open.onsuccess = () => {
      db = open.result;
      if (finished) { db.close(); return; }
      db.onversionchange = () => db?.close();
      try {
        tx = db.transaction('draft', 'readwrite');
        const request = action(tx.objectStore('draft'));
        tx.oncomplete = () => finish(undefined, request.result);
        tx.onabort = () => finish(tx?.error ?? new Error('Local storage aborted'));
        tx.onerror = () => finish(tx?.error);
      } catch (error) { finish(error); }
    };
  }));
  queue = run;
  return run;
}
export async function readDraft(): Promise<Draft | null> {
  const value = await transaction(store => store.get('current'));
  if (value === undefined) return null;
  if (validDraft(value)) return value;
  await writeDraft(null);
  return null;
}
export async function writeDraft(draft: Draft | null): Promise<void> {
  if (draft) await transaction(store => store.put(draft, 'current'));
  else await transaction(store => store.delete('current'));
}
