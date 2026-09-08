"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizePhoto, renderDocument, safeFilename, type RenderMode } from '@/lib/document';

type Artifact = { pdfBlob: Blob; url: string; preview: string };
type WebTool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown };
type ModelDocument = Document & { modelContext?: { registerTool: (tool: WebTool, options: { signal: AbortSignal }) => void | Promise<void> } };
const nextPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

export function useScanner() {
  const [preview, setPreview] = useState('');
  const [mode, setModeState] = useState<RenderMode>('bw');
  const [name, setName] = useState('Mon document');
  const [source, setSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fallback, setFallback] = useState(false);
  const original = useRef<HTMLCanvasElement | null>(null);
  const settings = useRef({ mode: 'bw' as RenderMode, rotation: 0 });
  const generation = useRef(0);
  const ownedUrls = useRef<string[]>([]);
  const sharing = useRef(false);

  const regenerate = useCallback(async () => {
    const canvas = original.current;
    if (!canvas) return null;
    const job = ++generation.current;
    setBusy(true); setArtifact(null); setError(''); setNotice('');
    try {
      await nextPaint();
      if (job !== generation.current) return null;
      const result = await renderDocument(canvas, settings.current.mode, settings.current.rotation);
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
    setBusy(true); setError(''); setNotice(''); setFallback(false);
    try {
      const normalized = await normalizePhoto(file);
      if (job !== generation.current) { normalized.width = 0; return; }
      if (original.current) { original.current.width = 0; original.current.height = 0; }
      original.current = normalized;
      settings.current.rotation = 0;
      setSource(true);
      await regenerate();
    } catch (cause) {
      if (job === generation.current) {
        setError(cause instanceof Error ? cause.message : 'Cette photo ne peut pas être ouverte. Essayez une autre image.');
        setBusy(false);
      }
    }
  }, [regenerate]);

  const setMode = useCallback((value: string) => {
    if (value !== 'bw' && value !== 'color') return;
    settings.current.mode = value;
    setModeState(value);
    void regenerate();
  }, [regenerate]);

  const rotate = useCallback(() => {
    settings.current.rotation = (settings.current.rotation + 90) % 360;
    void regenerate();
  }, [regenerate]);

  // PDF bytes are prepared before the tap so native sharing keeps user activation.
  const pdf = useMemo(() => artifact && !busy ? { url: artifact.url, file: new File([artifact.pdfBlob], safeFilename(name), { type: 'application/pdf' }) } : null, [artifact, busy, name]);

  const save = () => {
    setNotice('Téléchargement lancé. Si le PDF s’ouvre sur votre iPhone, touchez Partager puis « Enregistrer dans Fichiers ».');
  };

  const share = async () => {
    if (!pdf || sharing.current) return;
    setError(''); setNotice('');
    try {
      if (!navigator.share || !navigator.canShare?.({ files: [pdf.file] })) { setFallback(true); return; }
      sharing.current = true;
      await navigator.share({ files: [pdf.file], title: pdf.file.name });
      setNotice('Le partage a été ouvert. Terminez l’envoi dans l’application mail choisie.');
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === 'AbortError')) setFallback(true);
    } finally { sharing.current = false; }
  };

  const prepare = async (input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Options invalides.');
    const options = input as Record<string, unknown>;
    if (Object.keys(options).some(key => !['mode', 'name'].includes(key)) || (options.mode !== 'bw' && options.mode !== 'color') || (options.name !== undefined && (typeof options.name !== 'string' || options.name.length > 90))) throw new Error('Utilisez mode: bw ou color, et un nom de 90 caractères maximum.');
    if (!original.current || busy) throw new Error('Importez une photo et attendez la fin du traitement.');
    const filename = typeof options.name === 'string' ? options.name : name;
    setName(filename); setModeState(options.mode);
    settings.current.mode = options.mode;
    const result = await regenerate();
    if (!result) throw new Error('Le PDF n’a pas pu être créé.');
    await nextPaint();
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
        description: 'Prepare a PDF from the photo already selected in Pochette. Set the document rendering and optional filename. The PDF becomes ready in the visible interface; this does not download, share or send it.',
        inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['bw', 'color'] }, name: { type: 'string', maxLength: 90 } }, required: ['mode'], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: input => prepareRef.current(input),
      }, { signal: lifecycle.signal })).catch(() => { /* Optional browser capability. */ });
    } catch { /* The scanner also works without WebMCP. */ }
    return () => lifecycle.abort();
  }, []);

  useEffect(() => () => {
    generation.current++;
    for (const url of ownedUrls.current) URL.revokeObjectURL(url);
    if (original.current) { original.current.width = 0; original.current.height = 0; }
  }, []);

  const size = artifact ? (artifact.pdfBlob.size < 1024 * 1024 ? `${Math.max(1, Math.round(artifact.pdfBlob.size / 1024))} Ko` : `${(artifact.pdfBlob.size / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`) : '';
  return { preview, mode, setMode, name, setName, source, busy, pdf, error, notice, fallback, setFallback, load, rotate, save, share, size };
}
