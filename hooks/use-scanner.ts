"use client";
import { usePageCollection } from './use-page-collection.ts';
import { useLocalDraft } from './use-local-draft.ts';
import { usePdfExport } from './use-pdf-export.ts';
import { newSettings, copySettings, type ScanPage, type Settings } from '../lib/scan-page.ts';
import { translate, translateMessage, type Locale } from '@/lib/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_PAGES, DEFAULT_CONTRAST, cloneImageEdits, editorPreview, imageGeometry, normalizePhoto, renderDocument, rotateImageEdits, safeFilename, snapshotPhoto, type ImageEdits, type RenderMode } from '@/lib/document';

type Editor = { url: string; width: number; height: number; edits: ImageEdits; generation: number };
type WebTool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown };
type ModelDocument = Document & { modelContext?: { registerTool: (tool: WebTool, options: { signal: AbortSignal }) => void | Promise<void> } };
const nextPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const release = (canvas: HTMLCanvasElement | null) => { if (canvas) { canvas.width = 0; canvas.height = 0; } };

export function useScanner(locale: Locale = 'fr') {
  const pagesRef = useRef<ScanPage[]>([]);
  const activeId = useRef<number | null>(null);
  const nextId = useRef(0);
  const { pages, selectedId, setSelectedId, undo, setUndo, syncPages, commitAdditions, removeSelected, restoreUndo, reorderSelected } = usePageCollection(pagesRef, activeId);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [preview, setPreview] = useState('');
  const [mode, setModeState] = useState<RenderMode>('bw');
  const [contrast, setContrastState] = useState(DEFAULT_CONTRAST);
  const [customName, setName] = useState<string | null>(null);
  const name = customName ?? translate(locale, 'Mon document');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const original = useRef<HTMLCanvasElement | null>(null);
  const settings = useRef<Settings>(newSettings());
  const generation = useRef(0);
  const pendingRender = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRender = useRef<AbortController | null>(null);
  const activeImport = useRef<AbortController | null>(null);
  const activeEditor = useRef<AbortController | null>(null);
  const editorUrl = useRef<string | null>(null);

  const { pendingDraft, setPendingDraft, draftReady, draftStatus, discardDraft } = useLocalDraft(pagesRef, pages, customName, busy, setError);
  const { pdf, setArtifact, resetArtifact, publish, notice, setNotice, fallback, setFallback, save, share, size } = usePdfExport(pagesRef, generation, locale, name, busy, setError);

  const closeEditor = useCallback(() => {
    activeEditor.current?.abort(); activeEditor.current = null;
    if (editorUrl.current) { URL.revokeObjectURL(editorUrl.current); editorUrl.current = null; }
    setEditor(null);
  }, []);

  const cancelWork = useCallback(() => {
    generation.current++;
    if (pendingRender.current !== null) { clearTimeout(pendingRender.current); pendingRender.current = null; }
    activeRender.current?.abort(); activeRender.current = null;
    activeImport.current?.abort(); activeImport.current = null;
    closeEditor();
    setProgress(null); setBusy(false); setLoading(false); setError(''); setNotice(''); setFallback(false);
  }, [closeEditor, setNotice, setFallback]);

  const regenerate = useCallback(async () => {
    if (pendingRender.current !== null) { clearTimeout(pendingRender.current); pendingRender.current = null; }
    const canvas = original.current, page = pagesRef.current.find(page => page.id === activeId.current);
    if (!canvas || !page) return null;
    const job = ++generation.current;
    activeRender.current?.abort();
    const controller = new AbortController(); activeRender.current = controller;
    const snapshot = copySettings(settings.current);
    page.settings = snapshot; page.pdfBlob = null;
    setBusy(true); setArtifact(null); setError(''); setNotice('');
    try {
      await nextPaint(); controller.signal.throwIfAborted();
      if (job !== generation.current) return null;
      const result = await renderDocument(canvas, snapshot.mode, snapshot.rotation, snapshot.contrast, controller.signal, snapshot.edits);
      if (job !== generation.current) return null;
      const url = URL.createObjectURL(result.previewBlob);
      URL.revokeObjectURL(page.preview);
      page.previewBlob = result.previewBlob; page.preview = url; page.pdfBlob = result.pdfBlob;
      setPreview(url); syncPages();
      return await publish(job, controller.signal);
    } catch (cause) {
      if (job === generation.current) setError(cause instanceof Error ? cause.message : 'Le document n’a pas pu être créé. Réessayez sur cette page.');
      return null;
    } finally { if (job === generation.current) setBusy(false); }
  }, [publish, syncPages, setArtifact, setNotice]);

  const loadFiles = useCallback(async (files: File[], replaceCurrent = false) => {
    if (!files.length) return;
    const incoming = replaceCurrent ? files.slice(0, 1) : files;
    const retained = pagesRef.current.filter(page => !replaceCurrent || page.id !== activeId.current);
    if (retained.length + incoming.length > MAX_PAGES) {
      setError(`Un document peut contenir au maximum ${MAX_PAGES} pages.`); return;
    }
    if (incoming.reduce((total, file) => total + file.size, 0) > 100 * 1024 * 1024) {
      setError('Cet import dépasse 100 Mo. Ajoutez moins de photos à la fois.'); return;
    }
    cancelWork();
    const job = generation.current, controller = new AbortController();
    activeImport.current = controller;
    const replacingId = replaceCurrent ? activeId.current : null;
    const staged: { page: ScanPage; previewBlob: Blob }[] = [];
    let storedBytes = retained.reduce((total, page) => total + page.photo.size + 2 * (page.pdfBlob?.size ?? 0), 0);
    let workingCanvas: HTMLCanvasElement | null = null;
    setLoading(true); setBusy(true);
    try {
      for (const [index, file] of incoming.entries()) {
        setProgress({ current: index + 1, total: incoming.length });
        release(workingCanvas); workingCanvas = null;
        workingCanvas = await normalizePhoto(file, controller.signal);
        const photo = await snapshotPhoto(workingCanvas, controller.signal);
        const next = newSettings(settings.current.mode);
        const result = await renderDocument(workingCanvas, next.mode, 0, next.contrast, controller.signal, next.edits);
        controller.signal.throwIfAborted();
        storedBytes += photo.size + result.pdfBlob.size + result.previewBlob.size;
        if (storedBytes > 100 * 1024 * 1024) throw new Error('Ce document est trop volumineux. Enregistrez-le puis créez un autre PDF.');
        staged.push({ page: { id: ++nextId.current, photo, settings: next, pdfBlob: result.pdfBlob, preview: '', previewBlob: result.previewBlob }, previewBlob: result.previewBlob });
      }
      if (job !== generation.current) return;
      const additions = staged.map(item => ({ ...item.page, preview: URL.createObjectURL(item.previewBlob) }));
      commitAdditions(additions, replacingId, customName);
      const selected = additions[additions.length - 1];
      release(original.current); original.current = workingCanvas; workingCanvas = null;
      activeId.current = selected.id; settings.current = copySettings(selected.settings);
      setSelectedId(selected.id); setPreview(selected.preview); setModeState(selected.settings.mode); setContrastState(selected.settings.contrast);
      syncPages(); setLoading(false); setArtifact(null);
      activeImport.current = null; activeRender.current = controller;
      await publish(job, controller.signal);
    } catch (cause) {
      if (job === generation.current) setError(cause instanceof Error ? cause.message : 'Ces pages ne peuvent pas être ajoutées. Réessayez.');
    } finally {
      release(workingCanvas);
      if (activeImport.current === controller) activeImport.current = null;
      if (job === generation.current) { setProgress(null); setLoading(false); setBusy(false); }
    }
  }, [cancelWork, customName, commitAdditions, publish, syncPages, pagesRef, activeId, nextId, setSelectedId, setArtifact]);

  const selectPage = useCallback(async (id: number) => {
    const page = pagesRef.current.find(page => page.id === id);
    if (!page) return;
    cancelWork();
    const job = generation.current, controller = new AbortController();
    activeImport.current = controller; setBusy(true); setLoading(true);
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = await normalizePhoto(new File([page.photo], 'page.png', { type: 'image/png' }), controller.signal);
      controller.signal.throwIfAborted();
      if (job !== generation.current) return;
      release(original.current); original.current = canvas; canvas = null;
      activeId.current = id; settings.current = copySettings(page.settings);
      setSelectedId(id); setPreview(page.preview); setModeState(page.settings.mode); setContrastState(page.settings.contrast);
      setLoading(false); activeImport.current = null;
      if (page.pdfBlob) {
        activeRender.current = controller;
        await publish(job, controller.signal);
        if (job === generation.current) setBusy(false);
      } else await regenerate();
    } catch (cause) {
      if (job === generation.current) { setError(cause instanceof Error ? cause.message : 'Cette page ne peut pas être ouverte.'); setBusy(false); setLoading(false); }
    } finally {
      release(canvas);
      if (activeImport.current === controller) activeImport.current = null;
    }
  }, [cancelWork, publish, regenerate, setSelectedId]);

  const setMode = useCallback((value: string) => {
    if (value !== 'bw' && value !== 'color') return;
    settings.current.mode = value; setModeState(value); void regenerate();
  }, [regenerate]);

  const rotate = useCallback(() => {
    settings.current.edits = rotateImageEdits(settings.current.edits);
    settings.current.rotation = (settings.current.rotation + 90) % 360;
    void regenerate();
  }, [regenerate]);

  const setContrast = useCallback((value: number) => {
    if (!Number.isFinite(value) || loading || settings.current.mode !== 'bw') return;
    const next = Math.max(0, Math.min(100, Math.round(value)));
    if (settings.current.contrast === next) return;
    settings.current.contrast = next; setContrastState(next);
    if (!original.current) return;
    generation.current++; activeRender.current?.abort();
    setBusy(true); setArtifact(null); setError(''); setNotice('');
    if (pendingRender.current !== null) clearTimeout(pendingRender.current);
    pendingRender.current = setTimeout(() => { void regenerate(); }, 180);
  }, [loading, regenerate, setArtifact, setNotice]);

  const commitContrast = useCallback(() => { if (pendingRender.current !== null) void regenerate(); }, [regenerate]);

  const openEditor = useCallback(async () => {
    const canvas = original.current;
    if (!canvas || busy || editor) return;
    const job = ++generation.current, controller = new AbortController();
    activeEditor.current = controller; setBusy(true); setError('');
    try {
      const image = await editorPreview(canvas, settings.current.rotation, controller.signal);
      if (job !== generation.current) return;
      const url = URL.createObjectURL(image.blob); editorUrl.current = url;
      setEditor({ url, width: image.width, height: image.height, edits: cloneImageEdits(settings.current.edits), generation: job });
    } catch (cause) {
      if (job === generation.current) setError(cause instanceof Error ? cause.message : 'La photo ne peut pas être ouverte pour le recadrage.');
    } finally { if (job === generation.current) setBusy(false); }
  }, [busy, editor]);

  const applyEdits = useCallback((edits: ImageEdits) => {
    const canvas = original.current;
    if (!canvas || !editor || busy || editor.generation !== generation.current) return;
    try {
      const geometry = imageGeometry(canvas.width, canvas.height, settings.current.rotation, edits);
      settings.current.edits = cloneImageEdits({ ...edits, scale: geometry.effectiveScale });
      closeEditor(); void regenerate();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Choisissez un cadre valide.'); }
  }, [busy, closeEditor, editor, regenerate]);

  const clearPhoto = useCallback(() => {
    // Cancelling an import keeps the existing document, including all its pages.
    if (activeImport.current) { cancelWork(); return; }
    cancelWork();
    const index = removeSelected(customName);
    release(original.current); original.current = null;
    activeId.current = null; setSelectedId(null); setPreview(''); setArtifact(null); syncPages();
    if (pagesRef.current.length) {
      void selectPage(pagesRef.current[Math.min(Math.max(index, 0), pagesRef.current.length - 1)].id);
    } else {
      resetArtifact();
      settings.current = newSettings(); setModeState('bw'); setContrastState(DEFAULT_CONTRAST); setName(null);
    }
  }, [cancelWork, customName, removeSelected, resetArtifact, selectPage, syncPages, activeId, pagesRef, setSelectedId, setArtifact]);

  const undoLast = async () => {
    if (!undo || busy) return;
    cancelWork();
    const restored = restoreUndo();
    if (!restored) return;
    setName(restored.name); setArtifact(null);
    await selectPage(restored.page.id);
  };

  const movePage = async (offset: number) => {
    if (busy || !reorderSelected(offset)) return;
    cancelWork(); setBusy(true); setArtifact(null);
    const controller = new AbortController(); activeRender.current = controller;
    const job = generation.current;
    try { await publish(job, controller.signal); }
    catch { if (job === generation.current) setError('Le PDF n’a pas pu être créé.'); }
    finally { if (job === generation.current) setBusy(false); }
  };

  const restoreDraft = async () => {
    if (!pendingDraft || busy) return;
    cancelWork(); setBusy(true); setLoading(true);
    const job = generation.current, controller = new AbortController(); activeImport.current = controller;
    const staged: ScanPage[] = [];
    let canvas: HTMLCanvasElement | null = null;
    try {
      for (const [index, item] of pendingDraft.pages.entries()) {
        setProgress({ current: index + 1, total: pendingDraft.pages.length });
        release(canvas); canvas = null;
        canvas = await normalizePhoto(new File([item.photo], 'page.png', { type: 'image/png' }), controller.signal);
        const next = copySettings(item.settings);
        const rendered = await renderDocument(canvas, next.mode, next.rotation, next.contrast, controller.signal, next.edits);
        controller.signal.throwIfAborted();
        staged.push({ id: ++nextId.current, photo: item.photo, settings: next, ...rendered, preview: '' });
      }
      if (job !== generation.current) return;
      for (const page of pagesRef.current) URL.revokeObjectURL(page.preview);
      pagesRef.current = staged.map(page => ({ ...page, preview: URL.createObjectURL(page.previewBlob) }));
      const selected = pagesRef.current[0];
      release(original.current); original.current = null;
      setName(pendingDraft.name); setPendingDraft(null); setUndo(null); syncPages();
      activeImport.current = null;
      await selectPage(selected.id);
    } catch (cause) {
      if (job === generation.current) setError(cause instanceof Error ? cause.message : 'Le brouillon n’a pas pu être restauré.');
    } finally {
      release(canvas);
      if (activeImport.current === controller) activeImport.current = null;
      if (job === generation.current) { setProgress(null); setLoading(false); setBusy(false); }
    }
  };

  const prepare = async (input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Options invalides.');
    const options = input as Record<string, unknown>;
    if (Object.keys(options).some(key => !['mode', 'name', 'contrast'].includes(key)) || (options.mode !== 'bw' && options.mode !== 'color') || (options.name !== undefined && (typeof options.name !== 'string' || options.name.length > 90)) || (options.contrast !== undefined && (typeof options.contrast !== 'number' || !Number.isInteger(options.contrast) || options.contrast < 0 || options.contrast > 100))) throw new Error('Utilisez mode: bw ou color, un contraste entier de 0 à 100 et un nom de 90 caractères maximum.');
    if (!original.current || busy) throw new Error('Importez une photo et attendez la fin du traitement.');
    if (editor) throw new Error('Appliquez ou annulez le recadrage avant de préparer le PDF.');
    const filename = typeof options.name === 'string' ? options.name : name;
    setName(filename); setModeState(options.mode);
    settings.current.mode = options.mode;
    if (typeof options.contrast === 'number') {
      settings.current.contrast = Math.round(options.contrast);
      setContrastState(settings.current.contrast);
    }
    const result = await regenerate();
    if (!result) throw new Error('Le PDF n’a pas pu être créé.');
    const completedGeneration = generation.current;
    await nextPaint();
    if (completedGeneration !== generation.current) throw new Error('Le rendu a changé. Attendez la fin du traitement avant de préparer le PDF.');
    return { status: 'ready', filename: safeFilename(filename), pages: pagesRef.current.length, bytes: result.pdfBlob.size };
  };
  const prepareRef = useRef(prepare);
  useEffect(() => { prepareRef.current = prepare; });
  useEffect(() => {
    const context = (document as ModelDocument).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({
        name: 'prepare_current_pdf',
        description: 'Prepare one PDF from all pages in Scan and Send. Set the selected page rendering and optional document filename. The PDF becomes ready in the visible interface; this does not download, share or send it.',
        inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['bw', 'color'] }, name: { type: 'string', maxLength: 90 }, contrast: { type: 'integer', minimum: 0, maximum: 100, description: 'Black and white contrast; 50 is the default. Ignored for color rendering.' } }, required: ['mode'], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: input => prepareRef.current(input),
      }, { signal: lifecycle.signal })).catch(() => { /* Optional browser capability. */ });
    } catch { /* The scanner also works without WebMCP. */ }
    return () => lifecycle.abort();
  }, []);

  useEffect(() => () => {
    generation.current++;
    if (pendingRender.current !== null) clearTimeout(pendingRender.current);
    activeRender.current?.abort();
    activeImport.current?.abort();
    activeEditor.current?.abort();
    if (editorUrl.current) URL.revokeObjectURL(editorUrl.current);
    if (original.current) { original.current.width = 0; original.current.height = 0; }
  }, []);


  return { progress, pendingDraft, draftReady, draftStatus, restoreDraft, discardDraft, canUndo: !!undo && (undo.replacementId !== null || pages.length < MAX_PAGES), undoLast, movePage, pages, activeIndex: pages.findIndex(page => page.id === selectedId), source: pages.length > 0, preview, mode, setMode, contrast, setContrast, commitContrast, clearPhoto, editor, openEditor, closeEditor, applyEdits, defaultContrast: DEFAULT_CONTRAST, name, setName, busy, loading, pdf, error: translateMessage(locale, error), notice: translateMessage(locale, notice), fallback, setFallback, loadFiles, selectPage, rotate, save, share, size };
}
