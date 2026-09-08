"use client";
import { usePreferences, PreferenceControls } from '@/components/preferences';
import { useRef, useState } from 'react';
import { Camera, ImagePlus, ScanLine, ShieldCheck, FileText, Download, Mail, RotateCw, RefreshCw, Check, LoaderCircle, ArrowUpRight, Trash2, Crop, Plus } from 'lucide-react';
import { ImageEditor } from '@/components/image-editor';
import { ShareApp } from '@/components/share-app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { safeFilename } from '@/lib/document';
import { useScanner } from '@/hooks/use-scanner';

export default function Home() {
  const { t, locale } = usePreferences();
  const scan = useScanner(locale);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const addCamera = useRef<HTMLInputElement>(null);
  const addGallery = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const captureButton = useRef<HTMLButtonElement>(null);
  const clearPhoto = () => {
    scan.clearPhoto();
    if (camera.current) camera.current.value = '';
    if (gallery.current) gallery.current.value = '';
    requestAnimationFrame(() => captureButton.current?.focus());
  };
  const pick = (event: React.ChangeEvent<HTMLInputElement>, replace = false) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length) void scan.loadFiles(files, replace);
  };
  return <>
    <header className="site-header"><div className="header-inner">
      <div className="brand"><ScanLine className="brand-icon" aria-hidden="true" /><span>Scan <span className="brand-dot">and</span> Send</span></div>
      <PreferenceControls />
    </div></header>
    <main className="workspace">
      <input hidden ref={camera} type="file" accept="image/*" capture="environment" onChange={event => pick(event, scan.source)} aria-label={t("Prendre un document en photo")} />
      <input hidden ref={gallery} type="file" accept="image/*" multiple={!scan.source} onChange={event => pick(event, scan.source)} aria-label={t("Importer des photos")} />
      <input hidden ref={addCamera} type="file" accept="image/*" capture="environment" onChange={event => pick(event)} aria-label={t("Photographier une page supplémentaire")} />
      <input hidden ref={addGallery} type="file" accept="image/*" multiple onChange={event => pick(event)} aria-label={t("Ajouter des photos au document")} />
      <div className="work-grid">
        <section className="preview-panel" aria-label={t("Aperçu du document")}>
          <div className="panel-top"><strong>{t("Aperçu")}</strong><span className="page-label"><FileText aria-hidden="true" />{scan.source ? `Page ${Math.max(0, scan.activeIndex) + 1} / ${scan.pages.length}` : t("Aucune photo")}</span></div>
          <div className="preview-surface" aria-busy={scan.busy}>
            {scan.preview ? <img className="scan-image" src={scan.preview} alt={t(scan.mode === 'bw' ? 'Aperçu en noir et blanc' : 'Aperçu en couleur')} /> : <div className="empty-capture">
              <div className="capture-frame"><Camera aria-hidden="true" /></div>
              <h2>{t("Votre document commence ici")}</h2><p>{t("Posez-le à plat, dans un endroit éclairé, et cadrez la page entière.")}</p>
              <Button ref={captureButton} className="action capture-button" onClick={() => camera.current?.click()} disabled={scan.busy}><Camera />{t("Prendre une photo")}</Button>
              <Button variant="ghost" className="action import-button" onClick={() => gallery.current?.click()} disabled={scan.busy}><ImagePlus />{t("Importer une photo")}</Button>
            </div>}
            {scan.busy && <div className={scan.preview && !scan.loading ? 'preview-updating' : 'loading-overlay'} role="status"><LoaderCircle className="spin" aria-hidden="true" />{scan.preview && !scan.loading ? t("Mise à jour du rendu…") : t("Préparation de votre document…")}</div>}
          </div>
          {(scan.source || scan.loading) && <div className="preview-toolbar">
            {scan.source && <>
              <Button variant="ghost" className="tool-button" onClick={scan.openEditor} disabled={scan.busy}><Crop />{t("Rogner")}</Button>
              <Button variant="ghost" className="tool-button" onClick={() => camera.current?.click()} disabled={scan.busy}><Camera />{t("Reprendre")}</Button>
              <Button variant="ghost" className="tool-button" onClick={() => gallery.current?.click()} disabled={scan.busy}><RefreshCw />{t("Remplacer")}</Button>
              <Button variant="ghost" className="tool-button" onClick={scan.rotate} disabled={scan.busy}><RotateCw />{t("Tourner")}</Button>
            </>}
            <Button variant="ghost" className="tool-button clear-photo-button" onClick={clearPhoto} aria-label={scan.loading ? t("Annuler l’import") : t("Effacer la page sélectionnée")}><Trash2 />{scan.loading ? t("Annuler") : t("Effacer")}</Button>
          </div>}
          {scan.source && <div className="document-pages">
            {scan.pages.length > 1 && <div className="page-picker" aria-label={t("Pages du document")}>{scan.pages.map((page, index) => <Button key={page.id} variant="ghost" className={index === scan.activeIndex ? 'page-chip selected' : 'page-chip'} aria-pressed={index === scan.activeIndex} disabled={scan.busy} onClick={() => void scan.selectPage(page.id)}>Page {index + 1}</Button>)}</div>}
            <Button variant="outline" className="add-page" disabled={scan.busy} onClick={() => setAdding(true)}><Plus />{t("Ajouter une page")}</Button>
          </div>}
        </section>
        <section className="settings-panel" aria-label={t("Préparer et enregistrer le PDF")}>
          <div className="settings-section render-section">
            <div className="render-heading-row">
            <h2 className="section-heading" id="render-heading"><span className="step-num">01</span>{t("Rendu")}</h2>
            <div className="render-switch-row" role="group" aria-labelledby="render-heading">
              <span className={scan.mode === 'bw' ? 'active' : ''} title={t("Noir et blanc")} aria-label={t("Noir et blanc")}>{t("N&B")}</span>
              <Switch checked={scan.mode === 'color'} onCheckedChange={checked => scan.setMode(checked ? 'color' : 'bw')} disabled={scan.busy} aria-label={t("Rendu couleur")} />
              <span className={scan.mode === 'color' ? 'active' : ''}>{t("Couleur")}</span>
            </div>
            </div>
            {scan.mode === 'bw' && <div className="contrast-control">
              <div className="contrast-heading"><span id="contrast-label">{t("Contraste")}</span>
              <Slider
                className="contrast-slider"
                aria-labelledby="contrast-label"
                value={[scan.contrast]}
                min={0} max={100} step={1}
                disabled={!scan.source || scan.loading}
                onValueChange={value => scan.setContrast(Array.isArray(value) ? value[0] : value)}
                onValueCommitted={scan.commitContrast}
              />
              <output aria-label={t("Valeur du contraste")}>{scan.contrast} %</output></div>
              <div className="contrast-scale" aria-hidden="true"><span>{t("Plus clair")}</span><span>{t("Plus marqué")}</span></div>
              <div className="contrast-footnote"><span>{t("Ajustez la lisibilité du texte.")}</span><Button variant="ghost" className="contrast-reset" disabled={!scan.source || scan.loading || scan.contrast === scan.defaultContrast} onClick={() => scan.setContrast(scan.defaultContrast)}>{t("Réinitialiser")}</Button></div>
            </div>}
          </div>
          <div className="settings-section">
            <h2 className="section-heading"><span className="step-num">02</span>{t("Enregistrer votre PDF")}</h2>
            <div className="filename-row">
              <label className="field-label" htmlFor="filename">{t("Nom du document")}</label>
              <div className="filename-field"><Input id="filename" value={scan.name} onChange={event => scan.setName(event.target.value)} maxLength={90} autoComplete="off" spellCheck={false} /><span>.pdf</span></div>
            </div>
            <div className="pdf-summary"><span>{scan.pdf ? `${scan.pages.length} page${scan.pages.length > 1 ? 's' : ''} · ${scan.size}` : t("Format PDF · A4")}</span>{scan.pdf ? <span className="status-ready"><Check />{t("Prêt à enregistrer")}</span> : <span>{scan.busy ? t("Préparation…") : scan.source ? t("À préparer") : t("En attente de photo")}</span>}</div>
            <div className="export-actions">
              {scan.pdf ? <a className="action" href={scan.pdf.url} download={scan.pdf.file.name} onClick={scan.save}><Download />{t("Enregistrer le PDF")}</a> : <Button className="action" disabled><Download />{t("Enregistrer le PDF")}</Button>}
              <Button variant="outline" className="action" disabled={!scan.pdf || scan.busy} onClick={scan.share}><Mail />{t("Envoyer par mail")}</Button>
            </div>
            <p className="helper">{t("Le PDF s’enregistre dans vos fichiers.")}<br />{t("Pour l’envoyer, choisissez votre application mail.")}</p>
            {scan.pdf && <a className="pdf-open" href={scan.pdf.url} target="_blank" rel="noopener noreferrer">{t("Ouvrir le PDF")}<ArrowUpRight /></a>}
          </div>
          {scan.error && <p className="feedback error" role="alert">{scan.error}</p>}
          {scan.notice && <p className="feedback" role="status">{scan.notice}</p>}
        </section>
      </div>
      <footer className="site-footer"><p className="local-note"><ShieldCheck aria-hidden="true" />{t("Aucun document envoyé sur un serveur.")}</p><ShareApp /></footer>
    </main>
    {scan.editor && <ImageEditor key={scan.editor.url} image={scan.editor} onApply={scan.applyEdits} onCancel={scan.closeEditor} />}
    <Dialog open={adding} onOpenChange={setAdding}>
      <DialogContent className="mail-dialog" showCloseButton={false}>
        <DialogTitle>{t("Ajouter une page")}</DialogTitle>
        <DialogDescription>{t("Les nouvelles pages seront ajoutées à la suite, dans le même PDF.")}</DialogDescription>
        <div className="dialog-actions">
          <Button className="action" onClick={() => { setAdding(false); addCamera.current?.click(); }}><Camera />{t("Prendre une photo")}</Button>
          <Button variant="outline" className="action" onClick={() => { setAdding(false); addGallery.current?.click(); }}><ImagePlus />{t("Importer des photos")}</Button>
          <DialogClose render={<Button variant="ghost" className="action" />}>{t("Annuler")}</DialogClose>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={scan.fallback} onOpenChange={scan.setFallback}>
      <DialogContent className="mail-dialog" showCloseButton={false}>
        <DialogTitle>{t("Joindre votre PDF au mail")}</DialogTitle>
        <DialogDescription>{t("Ce navigateur ne permet pas de joindre le fichier automatiquement. Vous pouvez l’envoyer en deux étapes.")}</DialogDescription>
        <ol><li>{t("Enregistrez le PDF dans vos fichiers.")}</li><li>{t("Ouvrez votre messagerie, ajoutez le destinataire et joignez le PDF.")}</li></ol>
        <div className="dialog-actions">
          {scan.pdf && <a className="action download" href={scan.pdf.url} download={scan.pdf.file.name} onClick={scan.save}><Download />{t("Enregistrer le PDF")}</a>}
          <a className="action email" href={`mailto:?subject=${encodeURIComponent(safeFilename(scan.name || t("Mon document")).slice(0, -4))}&body=${encodeURIComponent(t("Bonjour,\n\nVous trouverez mon document en pièce jointe.\n\nBonne journée."))}`}><Mail />{t("Ouvrir ma messagerie")}</a>
          <DialogClose render={<Button variant="ghost" className="action" />}>{t("Fermer")}</DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
