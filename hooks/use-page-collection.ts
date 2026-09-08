import { useCallback, useEffect, useState, type RefObject } from 'react';
import { MAX_PAGES } from '../lib/image-geometry.ts';
import { copySettings, type ScanPage } from '../lib/scan-page.ts';
type Undo = { page: ScanPage; index: number; replacementId: number | null; name: string | null };
export function usePageCollection(pagesRef: RefObject<ScanPage[]>, activeId: RefObject<number | null>) {
  const [pages, setPages] = useState<{ id: number; preview: string }[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const syncPages = useCallback(() => setPages(pagesRef.current.map(({ id, preview }) => ({ id, preview }))), [pagesRef]);
  const commitAdditions = useCallback((additions: ScanPage[], replacingId: number | null, name: string | null) => {
    const index = pagesRef.current.findIndex(page => page.id === replacingId);
    if (index !== -1) {
      const old = pagesRef.current[index];
      setUndo({ page: { ...old, settings: copySettings(old.settings) }, index, replacementId: additions[0].id, name });
      URL.revokeObjectURL(old.preview);
      pagesRef.current = pagesRef.current.map((page, i) => i === index ? additions[0] : page);
    } else pagesRef.current = [...pagesRef.current, ...additions];
    syncPages();
  }, [syncPages, pagesRef]);
  const removeSelected = useCallback((name: string | null) => {
    const index = pagesRef.current.findIndex(page => page.id === activeId.current);
    if (index !== -1) {
      const page = pagesRef.current[index];
      setUndo({ page: { ...page, settings: copySettings(page.settings) }, index, replacementId: null, name });
      URL.revokeObjectURL(page.preview);
      pagesRef.current = pagesRef.current.filter(page => page.id !== activeId.current);
    }
    syncPages(); return index;
  }, [syncPages, pagesRef, activeId]);
  const restoreUndo = () => {
    if (!undo) return null;
    const replacement = pagesRef.current.findIndex(page => page.id === undo.replacementId);
    if (replacement === -1 && pagesRef.current.length >= MAX_PAGES) return null;
    const page = { ...undo.page, settings: copySettings(undo.page.settings), preview: URL.createObjectURL(undo.page.previewBlob) };
    if (replacement !== -1) {
      URL.revokeObjectURL(pagesRef.current[replacement].preview);
      pagesRef.current.splice(replacement, 1, page);
    } else pagesRef.current.splice(Math.min(undo.index, pagesRef.current.length), 0, page);
    setUndo(null); syncPages(); return { page, name: undo.name };
  };
  const reorderSelected = (offset: number) => {
    const index = pagesRef.current.findIndex(page => page.id === activeId.current), target = index + offset;
    if ((offset !== -1 && offset !== 1) || index < 0 || target < 0 || target >= pagesRef.current.length) return false;
    [pagesRef.current[index], pagesRef.current[target]] = [pagesRef.current[target], pagesRef.current[index]];
    syncPages(); return true;
  };
  useEffect(() => () => { for (const page of pagesRef.current) URL.revokeObjectURL(page.preview); }, [pagesRef]);
  return { pages, selectedId, setSelectedId, undo, setUndo, syncPages, commitAdditions, removeSelected, restoreUndo, reorderSelected };
}
