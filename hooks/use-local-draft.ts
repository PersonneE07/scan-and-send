import { useEffect, useState, type RefObject, type Dispatch, type SetStateAction } from 'react';
import { readDraft, writeDraft, type Draft } from '../lib/draft.ts';
import { copySettings, type ScanPage } from '../lib/scan-page.ts';
export function useLocalDraft(pagesRef: RefObject<ScanPage[]>, pages: { id: number; preview: string }[], customName: string | null, busy: boolean, setError: Dispatch<SetStateAction<string>>) {
  const [pendingDraft, setPendingDraft] = useState<Draft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftResult, setDraftResult] = useState<{ pages: { id: number; preview: string }[]; name: string | null; status: 'saved' | 'temporary' } | null>(null);
  useEffect(() => {
    let alive = true;
    readDraft().then(draft => { if (alive) setPendingDraft(draft); })
      .catch(() => { /* Export remains available without persistent storage. */ })
      .finally(() => { if (alive) setDraftReady(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!draftReady || pendingDraft || busy) return;
    let alive = true;
    const draft: Draft | null = pagesRef.current.length ? {
      version: 1, savedAt: Date.now(), name: customName,
      pages: pagesRef.current.map(page => ({ photo: page.photo, settings: copySettings(page.settings) })),
    } : null;
    writeDraft(draft).then(() => { if (alive) setDraftResult({ pages, name: customName, status: 'saved' }); })
      .catch(() => { if (alive) setDraftResult({ pages, name: customName, status: 'temporary' }); });
    return () => { alive = false; };
  }, [draftReady, pendingDraft, pages, customName, busy, pagesRef]);

  const discardDraft = async () => {
    try { await writeDraft(null); setPendingDraft(null); }
    catch { setError('Le brouillon local n’a pas pu être effacé. Réessayez.'); }
  };

  const draftStatus = !busy && draftResult?.pages === pages && draftResult.name === customName ? draftResult.status : 'saving';
  return { pendingDraft, setPendingDraft, draftReady, draftStatus, discardDraft };
}
