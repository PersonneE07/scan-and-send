"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CONTRAST, defaultImageEdits, editorPreview, imageGeometry, normalizePhoto, renderDocument, rotateCrop, safeFilename, type ImageEdits, type RenderMode } from '@/lib/document';

type Artifact = { pdfBlob: Blob; url: string; preview: string };
type Editor = { url: string; width: number; height: number; edits: ImageEdits; generation: number };
type WebTool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown };
type ModelDocument = Document & { modelContext?: { registerTool: (tool: WebTool, options: { signal: AbortSignal }) => void | Promise<void> } };
const nextPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

export function useScanner() {
  const [preview, setPreview] = useState('');
  const [mode, setModeState] = useState<RenderMode>('bw');
  const [contrast, setContrastState] = useState(DEFAULT_CONTRAST);
  const [name, setName] = useState('Mon document');
  const [source, setSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fallback, setFallback] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const original = useRef<HTMLCanvasElement | null>(null);
  const settings = useRef({ mode: 'bw' as RenderMode, rotation: 0, contrast: DEFAULT_CONTRAST, edits: defaultImageEdits() });
  const generation = useRef(0);
  const pendingRender = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRender = useRef<AbortController | null>(null);
  const activeImport = useRef<AbortController | null>(null);
  const activeEditor = useRef<AbortController | null>(null);
  const editorUrl = useRef<string | null>(null);
  const ownedUrls = useRef<string[]>([]);
  const sharing = useRef(false);

  const closeEditor = useCallback(() => {
    activeEditor.current?.abort(); activeEditor.current = null;
    if (editorUrl.current) { URL.revokeObjectURL(editorUrl.current); editorUrl.current = null; }
    setEditor(null);
  }, []);

  const regenerate = useCallback(async () => {
    if (pendingRender.current !== null) { clearTimeout(pendingRender.current); pendingRender.current = null; }
    const canvas = original.current;
    if (!canvas) return null;
    const job = ++generation.current;
    activeRender.current?.abort();
    const controller = new AbortController();
    activeRender.current = controller;
    const snapshot = { ...settings.current };
    setBusy(true); setArtifact(null); setError(''); setNotice('');
    try {
      await nextPaint();
      if (job !== generation.current) return null;
      const result = await renderDocument(canvas, snapshot.mode, snapshot.rotation, snapshot.contrast, controller.signal, snapshot.edits);
      if (job !== generation.current) return null;
      const next = { pdfBlob: result.pdfBlob, url: URL.createObjectURL(result.pdfBlob), preview: URL.createObjectURL(result.previewBlob) };
      for (const url of ownedUrls.current) URL.revokeObjectURL(url);
      ownedUrls.current = [next.url, next.preview];
      setArtifact(next); setPreview(next.preview);
      return next;
    } catch (cause) {
      if (job === generation.current) {
        setPreview('');
        setError(cause instanceof Error ? cause.message : 'Le document n’a pas pu être créé. Essayez une autre photo.');
      }
      return null;
    } finally { if (job === generation.current) setBusy(false); }
  }, []);

  const load = useCallback(async (file: File) => {
    const job = ++generation.current;
    closeEditor();
    activeImport.current?.abort();
    const controller = new AbortController();
    activeImport.current = controller;
    if (pendingRender.current !== null) { clearTimeout(pendingRender.current); pendingRender.current = null; }
    activeRender.current?.abort();
    setLoading(true); setBusy(true); setError(''); setNotice(''); setFallback(false);
    try {
      const normalized = await normalizePhoto(file, controller.signal);
      if (job !== generation.current) { normalized.width = 0; normalized.height = 0; return; }
      if (original.current) { original.current.width = 0; original.current.height = 0; }
      original.current = normalized;
      settings.current.rotation = 0;
      settings.current.contrast = DEFAULT_CONTRAST;
      settings.current.edits = defaultImageEdits();
      setContrastState(DEFAULT_CONTRAST);
      setLoading(false);
      setSource(true);
      await regenerate();
    } catch (cause) {
      if (job === generation.current) {
        setError(cause instanceof Error ? cause.message : 'Cette photo ne peut pas être ouverte. Essayez une autre image.');
        setBusy(false);
        setLoading(false);
      }
    } finally { if (activeImport.current === controller) activeImport.current = null; }
  }, [closeEditor, regenerate]);

  const setMode = useCallback((value: string) => {
    if (value !== 'bw' && value !== 'color') return;
    settings.current.mode = value;
    setModeState(value);
    void regenerate();
  }, [regenerate]);

  const rotate = useCallback(() => {
    settings.current.edits = { ...settings.current.edits, crop: rotateCrop(settings.current.edits.crop) };
    settings.current.rotation = (settings.current.rotation + 90) % 360;
    void regenerate();
  }, [regenerate]);

  const setContrast = useCallback((value: number) => {
    if (!Number.isFinite(value) || loading || settings.current.mode !== 'bw') return;
    const next = Math.max(0, Math.min(100, Math.round(value)));
    if (settings.current.contrast === next) return;
    settings.current.contrast = next;
    setContrastState(next);
    if (!original.current) return;
    // Disable stale exports immediately, while coalescing touch/keyboard changes.
    generation.current++;
    activeRender.current?.abort();
    setBusy(true); setArtifact(null); setError(''); setNotice('');
    if (pendingRender.current !== null) clearTimeout(pendingRender.current);
    pendingRender.current = setTimeout(() => { void regenerate(); }, 180);
  }, [loading, regenerate]);

  const commitContrast = useCallback(() => {
    if (pendingRender.current !== null) void regenerate();
  }, [regenerate]);

  const openEditor = useCallback(async () => {
    const canvas = original.current;
    if (!canvas || busy || editor) return;
    const job = ++generation.current;
    const controller = new AbortController();
    activeEditor.current = controller;
    setBusy(true); setError('');
    try {
      const image = await editorPreview(canvas, settings.current.rotation, controller.signal);
      if (job !== generation.current) return;
      const url = URL.createObjectURL(image.blob);
      editorUrl.current = url;
      setEditor({ url, width: image.width, height: image.height, edits: { ...settings.current.edits, crop: { ...settings.current.edits.crop } }, generation: job });
    } catch (cause) {
      if (job === generation.current) setError(cause instanceof Error ? cause.message : 'La photo ne peut pas être ouverte pour le recadrage.');
    } finally { if (job === generation.current) setBusy(false); }
  }, [busy, editor]);

  const applyEdits = useCallback((edits: ImageEdits) => {
    const canvas = original.current;
    if (!canvas || !editor || busy || editor.generation !== generation.current) return;
    try {
      const geometry = imageGeometry(canvas.width, canvas.height, settings.current.rotation, edits);
      settings.current.edits = { crop: { ...edits.crop }, scale: geometry.effectiveScale };
      closeEditor();
      void regenerate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Choisissez un cadre valide.');
    }
  }, [busy, closeEditor, editor, regenerate]);

  const clearPhoto = useCallback(() => {
    // Invalidate every pending import/render before releasing the current document.
    generation.current++;
    closeEditor();
    if (pendingRender.current !== null) { clearTimeout(pendingRender.current); pendingRender.current = null; }
    activeRender.current?.abort();
    activeRender.current = null;
    activeImport.current?.abort();
    activeImport.current = null;
    if (original.current) { original.current.width = 0; original.current.height = 0; original.current = null; }
    for (const url of ownedUrls.current) URL.revokeObjectURL(url);
    ownedUrls.current = [];
    settings.current = { mode: 'bw', rotation: 0, contrast: DEFAULT_CONTRAST, edits: defaultImageEdits() };
    setPreview(''); setArtifact(null); setSource(false);
    setBusy(false); setLoading(false); setFallback(false);
    setModeState('bw'); setContrastState(DEFAULT_CONTRAST); setName('Mon document');
    setError(''); setNotice('');
  }, [closeEditor]);

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
    return { status: 'ready', filename: safeFilename(filename), pages: 1, bytes: result.pdfBlob.size };
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
        description: 'Prepare a PDF from the photo already selected in Scan and Send. Set the document rendering and optional filename. The PDF becomes ready in the visible interface; this does not download, share or send it.',
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
    for (const url of ownedUrls.current) URL.revokeObjectURL(url);
    if (original.current) { original.current.width = 0; original.current.height = 0; }
  }, []);

  const size = artifact ? (artifact.pdfBlob.size < 1024 * 1024 ? `${Math.max(1, Math.round(artifact.pdfBlob.size / 1024))} Ko` : `${(artifact.pdfBlob.size / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`) : '';
  return { preview, mode, setMode, contrast, setContrast, commitContrast, clearPhoto, editor, openEditor, closeEditor, applyEdits, defaultContrast: DEFAULT_CONTRAST, name, setName, source, busy, loading, pdf, error, notice, fallback, setFallback, load, rotate, save, share, size };
}
