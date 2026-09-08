import { useCallback, useEffect, useMemo, useRef, useState, type RefObject, type Dispatch, type SetStateAction } from 'react';
import { combinePages } from '../lib/pdf.ts';
import { safeFilename } from '../lib/filename.ts';
import { translate, type Locale } from '../lib/i18n.ts';
import type { ScanPage } from '../lib/scan-page.ts';
type Artifact = { pdfBlob: Blob; url: string };
export function usePdfExport(pagesRef: RefObject<ScanPage[]>, generation: RefObject<number>, locale: Locale, name: string, busy: boolean, setError: Dispatch<SetStateAction<string>>) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [notice, setNotice] = useState('');
  const [fallback, setFallback] = useState(false);
  const documentUrl = useRef<string | null>(null);
  const sharing = useRef(false);
  const publish = useCallback(async (job: number, signal: AbortSignal) => {
    const current = [...pagesRef.current];
    const missing = current.findIndex(page => !page.pdfBlob);
    if (missing !== -1) throw new Error(`La page ${missing + 1} doit être préparée. Sélectionnez-la pour réessayer.`);
    const pdfBlob = await combinePages(current.map(page => page.pdfBlob!), signal, locale);
    if (job !== generation.current) return null;
    const url = URL.createObjectURL(pdfBlob);
    if (documentUrl.current) URL.revokeObjectURL(documentUrl.current);
    documentUrl.current = url;
    const next = { pdfBlob, url }; setArtifact(next); return next;
  }, [locale, pagesRef, generation]);

  // PDF bytes are prepared before the tap so native sharing keeps user activation.
  const pdf = useMemo(() => artifact && !busy ? { url: artifact.url, file: new File([artifact.pdfBlob], safeFilename(name || translate(locale, 'Mon document')), { type: 'application/pdf' }) } : null, [artifact, busy, name, locale]);

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
      if (sharedGeneration === generation.current) setNotice('Le partage a été ouvert. Terminez l’envoi dans l’application choisie.');
    } catch (cause) {
      if (sharedGeneration === generation.current && !(cause instanceof Error && cause.name === 'AbortError')) setFallback(true);
    } finally { sharing.current = false; }
  };

  const size = artifact ? (artifact.pdfBlob.size < 1024 * 1024 ? `${Math.max(1, Math.round(artifact.pdfBlob.size / 1024))} ${locale === 'fr' ? 'Ko' : 'KB'}` : `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(artifact.pdfBlob.size / (1024 * 1024))} ${locale === 'fr' ? 'Mo' : 'MB'}`) : '';
  const resetArtifact = useCallback(() => {
    if (documentUrl.current) { URL.revokeObjectURL(documentUrl.current); documentUrl.current = null; }
    setArtifact(null);
  }, []);
  useEffect(() => () => { if (documentUrl.current) URL.revokeObjectURL(documentUrl.current); }, []);
  return { pdf, setArtifact, resetArtifact, publish, notice, setNotice, fallback, setFallback, save, share, size };
}
