"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CONTRAST, cloneImageEdits, combinePages, defaultImageEdits, editorPreview, imageGeometry, normalizePhoto, renderDocument, rotateImageEdits, safeFilename, snapshotPhoto, type ImageEdits, type RenderMode } from '@/lib/document';

type Settings = { mode: RenderMode; rotation: number; contrast: number; edits: ImageEdits };
type ScanPage = { id: number; photo: Blob; settings: Settings; pdfBlob: Blob | null; preview: string };
type Artifact = { pdfBlob: Blob; url: string };
type Editor = { url: string; width: number; height: number; edits: ImageEdits; generation: number };
type WebTool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown };
type ModelDocument = Document & { modelContext?: { registerTool: (tool: WebTool, options: { signal: AbortSignal }) => void | Promise<void> } };
const nextPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const newSettings = (mode: RenderMode = 'bw'): Settings => ({ mode, rotation: 0, contrast: DEFAULT_CONTRAST, edits: defaultImageEdits() });
const copySettings = (settings: Settings): Settings => ({ ...settings, edits: cloneImageEdits(settings.edits) });
const release = (canvas: HTMLCanvasElement | null) => { if (canvas) { canvas.width = 0; canvas.height = 0; } };

export function useScanner() {
  const [preview, setPreview] = useState('');
  const [mode, setModeState] = useState<RenderMode>('bw');
  const [contrast, setContrastState] = useState(DEFAULT_CONTRAST);
  const [name, setName] = useState('Mon document');
  const [pages, setPages] = useState<{ id: number; preview: string }[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fallback, setFallback] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const pagesRef = useRef<ScanPage[]>([]);
  const activeId = useRef<number | null>(null);
  const nextId = useRef(0);
  const original = useRef<HTMLCanvasElement | null>(null);
  const settings = useRef<Settings>(newSettings());
  const generation = useRef(0);
  const pendingRender = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRender = useRef<AbortController | null>(null);
  const activeImport = useRef<AbortController | null>(null);
  const activeEditor = useRef<AbortController | null>(null);
  const editorUrl = useRef<string | null>(null);
  const documentUrl = useRef<string | null>(null);
  const sharing = useRef(false);
  const syncPages = useCallback(() => setPages(pagesRef.current.map(page => ({ id: page.id, preview: page.preview }))), []);

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
    setBusy(false); setLoading(false); setError(''); setNotice(''); setFallback(false);
  }, [closeEditor]);

  const publish = useCallback(async (job: number, signal: AbortSignal) => {
    const current = [...pagesRef.current];
    const missing = current.findIndex(page => !page.pdfBlob);
    if (missing !== -1) throw new Error(`La page ${missing + 1} doit être préparée. Sélectionnez-la pour réessayer.`);
    const pdfBlob = await combinePages(current.map(page => page.pdfBlob!), signal);
    if (job !== generation.current) return null;
    const url = URL.createObjectURL(pdfBlob);
    if (documentUrl.current) URL.revokeObjectURL(documentUrl.current);
    documentUrl.current = url;
    const next = { pdfBlob, url }; setArtifact(next); return next;
  }, []);

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
      page.preview = url; page.pdfBlob = result.pdfBlob;
      setPreview(url); syncPages();
      return await publish(job, controller.signal);
    } catch (cause) {
      if (job === generation.current) setError(cause instanceof Error ? cause.message : 'Le document n’a pas pu être créé. Réessayez sur cette page.');
      return null;
    } finally { if (job === generation.current) setBusy(false); }
  }, [publish, syncPages]);

  const loadFiles = useCallback(async (files: File[], replaceCurrent = false) => {
    if (!files.length) return;
    cancelWork();
    const job = generation.current, controller = new AbortController();
    activeImport.current = controller;
    const replacingId = replaceCurrent ? activeId.current : null;
    const staged: { page: ScanPage; previewBlob: Blob }[] = [];
    let workingCanvas: HTMLCanvasElement | null = null;
    setLoading(true); setBusy(true);
    try {
      for (const file of replaceCurrent ? files.slice(0, 1) : files) {
        release(workingCanvas); workingCanvas = null;
        workingCanvas = await normalizePhoto(file, controller.signal);
        const photo = await snapshotPhoto(workingCanvas, controller.signal);
        const next = newSettings(settings.current.mode);
        const result = await renderDocument(workingCanvas, next.mode, 0, next.contrast, controller.signal, next.edits);
        controller.signal.throwIfAborted();
        staged.push({ page: { id: ++nextId.current, photo, settings: next, pdfBlob: result.pdfBlob, preview: '' }, previewBlob: result.previewBlob });
      }
      if (job !== generation.current) return;
      const additions = staged.map(item => ({ ...item.page, preview: URL.createObjectURL(item.previewBlob) }));
      const replaceIndex = pagesRef.current.findIndex(page => page.id === replacingId);
      if (replaceIndex !== -1) {
        URL.revokeObjectURL(pagesRef.current[replaceIndex].preview);
        pagesRef.current = pagesRef.current.map((page, index) => index === replaceIndex ? additions[0] : page);
      } else pagesRef.current = [...pagesRef.current, ...additions];
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
      if (job === generation.current) { setLoading(false); setBusy(false); }
    }
  }, [cancelWork, publish, syncPages]);

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
      await regenerate();
    } catch (cause) {
      if (job === generation.current) { setError(cause instanceof Error ? cause.message : 'Cette page ne peut pas être ouverte.'); setBusy(false); setLoading(false); }
    } finally {
      release(canvas);
      if (activeImport.current === controller) activeImport.current = null;
    }
  }, [cancelWork, regenerate]);

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
  }, [loading, regenerate]);

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
    const index = pagesRef.current.findIndex(page => page.id === activeId.current);
    if (index !== -1) URL.revokeObjectURL(pagesRef.current[index].preview);
    pagesRef.current = pagesRef.current.filter(page => page.id !== activeId.current);
    release(original.current); original.current = null;
    activeId.current = null; setSelectedId(null); setPreview(''); setArtifact(null); syncPages();
    if (pagesRef.current.length) {
      void selectPage(pagesRef.current[Math.min(Math.max(index, 0), pagesRef.current.length - 1)].id);
    } else {
      if (documentUrl.current) { URL.revokeObjectURL(documentUrl.current); documentUrl.current = null; }
      settings.current = newSettings(); setModeState('bw'); setContrastState(DEFAULT_CONTRAST); setName('Mon document');
    }
  }, [cancelWork, selectPage, syncPages]);

  // PDF bytes are prepared before the tap so native sharing keeps user activation.
  const pdf = useMemo(() => artifact && !busy ? { url: artifact.url, file: new File([artifact.pdfBlob], safeFilename(name), { type: 'application/pdf' }) } : null, [artifact, busy, name]);

  const save = () => {
    setNotice('Téléchargement lancé. Si le PDF s’ouvre sur votre iPhone, touchez Partager puis « Enregistrer dans Fichiers ».');
  };

  const share = async () => {
    if (!pdf || sharing.current) return;
    const sharedGeneration = generation.current;
    setError(''); setNotice('');
    try {
      if (!navigator.share || !navigator.canShare?.({ files: [pdf.file] })) { setFallback(true); return; }
      sharing.current = true;
      await navigator.share({ files: [pdf.file], title: pdf.file.name });
      if (sharedGeneration === generation.current) setNotice('Le partage a été ouvert. Terminez l’envoi dans l’application mail choisie.');
    } catch (cause) {
      if (sharedGeneration === generation.current && !(cause instanceof Error && cause.name === 'AbortError')) setFallback(true);
    } finally { sharing.current = false; }
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
    for (const page of pagesRef.current) URL.revokeObjectURL(page.preview);
    if (documentUrl.current) URL.revokeObjectURL(documentUrl.current);
    if (original.current) { original.current.width = 0; original.current.height = 0; }
  }, []);

  const size = artifact ? (artifact.pdfBlob.size < 1024 * 1024 ? `${Math.max(1, Math.round(artifact.pdfBlob.size / 1024))} Ko` : `${(artifact.pdfBlob.size / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`) : '';
  return { pages, activeIndex: pages.findIndex(page => page.id === selectedId), source: pages.length > 0, preview, mode, setMode, contrast, setContrast, commitContrast, clearPhoto, editor, openEditor, closeEditor, applyEdits, defaultContrast: DEFAULT_CONTRAST, name, setName, busy, loading, pdf, error, notice, fallback, setFallback, loadFiles, selectPage, rotate, save, share, size };
}
