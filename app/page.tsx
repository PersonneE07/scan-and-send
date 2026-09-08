"use client";
import { useRef, useState } from 'react';
import { Camera, ImagePlus, ScanLine, ShieldCheck, LockKeyhole, FileText, Download, Mail, RotateCw, RefreshCw, Check, LoaderCircle, ArrowUpRight, Trash2, Crop, Plus } from 'lucide-react';
import { ImageEditor } from '@/components/image-editor';
import { ShareApp } from '@/components/share-app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { useScanner } from '@/hooks/use-scanner';

export default function Home() {
  const scan = useScanner();
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
      <div className="private-label" title="Les documents sont traités sur votre appareil"><ShieldCheck aria-hidden="true" /><span>Sur votre appareil, simplement.</span></div>
    </div></header>
    <main className="workspace">
      <div className="page-intro"><div><h1>Nouveau document</h1><p>Une ou plusieurs pages, le bon rendu, et votre PDF est prêt.</p></div><div className="flow-label" aria-hidden="true">Photo <span>→</span> Rendu <span>→</span> PDF</div></div>
      <input hidden ref={camera} type="file" accept="image/*" capture="environment" onChange={event => pick(event, scan.source)} aria-label="Prendre un document en photo" />
      <input hidden ref={gallery} type="file" accept="image/*" multiple={!scan.source} onChange={event => pick(event, scan.source)} aria-label="Importer des photos" />
      <input hidden ref={addCamera} type="file" accept="image/*" capture="environment" onChange={event => pick(event)} aria-label="Photographier une page supplémentaire" />
      <input hidden ref={addGallery} type="file" accept="image/*" multiple onChange={event => pick(event)} aria-label="Ajouter des photos au document" />
      <div className="work-grid">
        <section className="preview-panel" aria-label="Aperçu du document">
          <div className="panel-top"><strong>Aperçu</strong><span className="page-label"><FileText aria-hidden="true" />{scan.source ? `Page ${Math.max(0, scan.activeIndex) + 1} / ${scan.pages.length}` : 'Aucune photo'}</span></div>
          <div className="preview-surface" aria-busy={scan.busy}>
            {scan.preview ? <img className="scan-image" src={scan.preview} alt={`Aperçu de votre document en ${scan.mode === 'bw' ? 'noir et blanc' : 'couleur'}`} /> : <div className="empty-capture">
              <div className="capture-frame"><Camera aria-hidden="true" /></div>
              <h2>Votre document commence ici</h2><p>Posez-le à plat, dans un endroit éclairé, et cadrez la page entière.</p>
              <Button ref={captureButton} className="action capture-button" onClick={() => camera.current?.click()} disabled={scan.busy}><Camera />Prendre une photo</Button>
              <Button variant="ghost" className="action import-button" onClick={() => gallery.current?.click()} disabled={scan.busy}><ImagePlus />Importer une photo</Button>
            </div>}
            {scan.busy && <div className={scan.preview && !scan.loading ? 'preview-updating' : 'loading-overlay'} role="status"><LoaderCircle className="spin" aria-hidden="true" />{scan.preview && !scan.loading ? 'Mise à jour du rendu…' : 'Préparation de votre document…'}</div>}
          </div>
          {(scan.source || scan.loading) && <div className="preview-toolbar">
            {scan.source && <>
              <Button variant="ghost" className="tool-button" onClick={scan.openEditor} disabled={scan.busy}><Crop />Rogner</Button>
              <Button variant="ghost" className="tool-button" onClick={() => camera.current?.click()} disabled={scan.busy}><Camera />Reprendre</Button>
              <Button variant="ghost" className="tool-button" onClick={() => gallery.current?.click()} disabled={scan.busy}><RefreshCw />Remplacer</Button>
              <Button variant="ghost" className="tool-button" onClick={scan.rotate} disabled={scan.busy}><RotateCw />Tourner</Button>
            </>}
            <Button variant="ghost" className="tool-button clear-photo-button" onClick={clearPhoto} aria-label={scan.loading ? 'Annuler l’import' : 'Effacer la page sélectionnée'}><Trash2 />{scan.loading ? 'Annuler' : 'Effacer'}</Button>
          </div>}
          {scan.source && <div className="document-pages">
            {scan.pages.length > 1 && <div className="page-picker" aria-label="Pages du document">{scan.pages.map((page, index) => <Button key={page.id} variant="ghost" className={index === scan.activeIndex ? 'page-chip selected' : 'page-chip'} aria-pressed={index === scan.activeIndex} disabled={scan.busy} onClick={() => void scan.selectPage(page.id)}>Page {index + 1}</Button>)}</div>}
            <Button variant="outline" className="add-page" disabled={scan.busy} onClick={() => setAdding(true)}><Plus />Ajouter une page</Button>
          </div>}
          <div className="preview-bottom"><LockKeyhole aria-hidden="true" />Vos photos restent sur votre appareil.</div>
        </section>
        <section className="settings-panel" aria-label="Préparer et enregistrer le PDF">
          <div className="settings-section render-section">
            <h2 className="section-heading" id="render-heading"><span className="step-num">01</span>Rendu</h2>
            <div className="render-switch-row" role="group" aria-labelledby="render-heading">
              <span className={scan.mode === 'bw' ? 'active' : ''}>Noir et blanc</span>
              <Switch checked={scan.mode === 'color'} onCheckedChange={checked => scan.setMode(checked ? 'color' : 'bw')} disabled={scan.busy} aria-label="Rendu couleur" />
              <span className={scan.mode === 'color' ? 'active' : ''}>Couleur</span>
            </div>
            {scan.mode === 'bw' && <div className="contrast-control">
              <div className="contrast-heading"><span id="contrast-label">Contraste</span><output aria-label="Valeur du contraste">{scan.contrast} %</output></div>
              <Slider
                className="contrast-slider"
                aria-labelledby="contrast-label"
                value={[scan.contrast]}
                min={0} max={100} step={1}
                disabled={!scan.source || scan.loading}
                onValueChange={value => scan.setContrast(Array.isArray(value) ? value[0] : value)}
                onValueCommitted={scan.commitContrast}
              />
              <div className="contrast-scale" aria-hidden="true"><span>Plus clair</span><span>Plus marqué</span></div>
              <div className="contrast-footnote"><span>Ajustez la lisibilité du texte.</span><Button variant="ghost" className="contrast-reset" disabled={!scan.source || scan.loading || scan.contrast === scan.defaultContrast} onClick={() => scan.setContrast(scan.defaultContrast)}>Réinitialiser</Button></div>
            </div>}
          </div>
          <div className="settings-section">
            <h2 className="section-heading"><span className="step-num">02</span>Enregistrer votre PDF</h2>
            <label className="field-label" htmlFor="filename">Nom du document</label>
            <div className="filename-field"><Input id="filename" value={scan.name} onChange={event => scan.setName(event.target.value)} maxLength={90} autoComplete="off" spellCheck={false} /><span>.pdf</span></div>
            <div className="pdf-summary"><span>{scan.pdf ? `${scan.pages.length} page${scan.pages.length > 1 ? 's' : ''} · ${scan.size}` : 'Format PDF · A4'}</span>{scan.pdf ? <span className="status-ready"><Check />Prêt à enregistrer</span> : <span>{scan.busy ? 'Préparation…' : scan.source ? 'À préparer' : 'En attente de photo'}</span>}</div>
            <div className="export-actions">
              {scan.pdf ? <a className="action" href={scan.pdf.url} download={scan.pdf.file.name} onClick={scan.save}><Download />Enregistrer le PDF</a> : <Button className="action" disabled><Download />Enregistrer le PDF</Button>}
              <Button variant="outline" className="action" disabled={!scan.pdf || scan.busy} onClick={scan.share}><Mail />Envoyer par mail</Button>
            </div>
            <p className="helper">Le PDF s’enregistre dans vos fichiers.<br />Pour l’envoyer, choisissez votre application mail.</p>
            {scan.pdf && <a className="pdf-open" href={scan.pdf.url} target="_blank" rel="noopener noreferrer">Ouvrir le PDF<ArrowUpRight /></a>}
          </div>
          {scan.error && <p className="feedback error" role="alert">{scan.error}</p>}
          {scan.notice && <p className="feedback" role="status">{scan.notice}</p>}
        </section>
      </div>
      <footer className="site-footer"><p className="local-note"><ShieldCheck aria-hidden="true" />Aucun document envoyé sur un serveur.</p><ShareApp /></footer>
    </main>
    {scan.editor && <ImageEditor key={scan.editor.url} image={scan.editor} onApply={scan.applyEdits} onCancel={scan.closeEditor} />}
    <Dialog open={adding} onOpenChange={setAdding}>
      <DialogContent className="mail-dialog" showCloseButton={false}>
        <DialogTitle>Ajouter une page</DialogTitle>
        <DialogDescription>Les nouvelles pages seront ajoutées à la suite, dans le même PDF.</DialogDescription>
        <div className="dialog-actions">
          <Button className="action" onClick={() => { setAdding(false); addCamera.current?.click(); }}><Camera />Prendre une photo</Button>
          <Button variant="outline" className="action" onClick={() => { setAdding(false); addGallery.current?.click(); }}><ImagePlus />Importer des photos</Button>
          <DialogClose render={<Button variant="ghost" className="action" />}>Annuler</DialogClose>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={scan.fallback} onOpenChange={scan.setFallback}>
      <DialogContent className="mail-dialog" showCloseButton={false}>
        <DialogTitle>Joindre votre PDF au mail</DialogTitle>
        <DialogDescription>Ce navigateur ne permet pas de joindre le fichier automatiquement. Vous pouvez l’envoyer en deux étapes.</DialogDescription>
        <ol><li>Enregistrez le PDF dans vos fichiers.</li><li>Ouvrez votre messagerie, ajoutez le destinataire et joignez le PDF.</li></ol>
        <div className="dialog-actions">
          {scan.pdf && <a className="action download" href={scan.pdf.url} download={scan.pdf.file.name} onClick={scan.save}><Download />Enregistrer le PDF</a>}
          <a className="action email" href={`mailto:?subject=${encodeURIComponent(scan.name || 'Mon document')}&body=${encodeURIComponent('Bonjour,\n\nVous trouverez mon document en pièce jointe.\n\nBonne journée.')}`}><Mail />Ouvrir ma messagerie</a>
          <DialogClose render={<Button variant="ghost" className="action" />}>Fermer</DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
