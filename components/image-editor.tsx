"use client";

import { useState } from 'react';
import ReactCrop from 'react-image-crop';
import { Check, LockKeyhole, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { defaultImageEdits, imageGeometry, type CropArea, type ImageEdits } from '@/lib/document';

type Props = {
  image: { url: string; width: number; height: number; edits: ImageEdits };
  onApply: (edits: ImageEdits) => void;
  onCancel: () => void;
};

export function ImageEditor({ image, onApply, onCancel }: Props) {
  const [crop, setCrop] = useState<CropArea>({ ...image.edits.crop });
  const [scale, setScale] = useState(image.edits.scale);
  const [draft, setDraft] = useState<{ axis: 'width' | 'height'; text: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const geometry = imageGeometry(image.width, image.height, 0, { crop, scale });
  const draftValue = draft ? Number(draft.text) : null;
  const draftMax = draft?.axis === 'width' ? geometry.maxWidth : geometry.maxHeight;
  const invalidSize = draft !== null && (!draft.text.trim() || !Number.isInteger(draftValue) || draftValue! < 1 || draftValue! > draftMax);

  const changeDimension = (axis: 'width' | 'height', text: string) => {
    setDraft({ axis, text });
    const value = Number(text);
    const maximum = axis === 'width' ? geometry.maxWidth : geometry.maxHeight;
    if (text.trim() && Number.isInteger(value) && value >= 1 && value <= maximum) {
      setScale(value / (axis === 'width' ? geometry.cropWidth : geometry.cropHeight));
    }
  };

  const reset = () => {
    const initial = defaultImageEdits();
    setCrop(initial.crop); setScale(initial.scale); setDraft(null);
  };

  return <Dialog open onOpenChange={open => { if (!open) onCancel(); }}>
    <DialogContent className="crop-dialog" showCloseButton={false}>
      <div className="crop-heading">
        <DialogTitle>Rogner et redimensionner</DialogTitle>
        <DialogDescription>Déplacez les coins du cadre pour garder uniquement la zone souhaitée.</DialogDescription>
      </div>
      <div className="crop-stage">
        <ReactCrop
          crop={crop}
          onChange={(_, next) => {
            if (next.width > 0 && next.height > 0) { setCrop(next); setDraft(null); }
          }}
          minWidth={24}
          minHeight={24}
          keepSelection
          ruleOfThirds
          ariaLabels={{
            cropArea: 'Zone conservée. Utilisez les flèches pour déplacer le cadre.',
            nwDragHandle: 'Coin supérieur gauche', nDragHandle: 'Bord supérieur',
            neDragHandle: 'Coin supérieur droit', eDragHandle: 'Bord droit',
            seDragHandle: 'Coin inférieur droit', sDragHandle: 'Bord inférieur',
            swDragHandle: 'Coin inférieur gauche', wDragHandle: 'Bord gauche',
          }}
        >
          <img src={image.url} alt="Photo à recadrer" draggable={false} onLoad={() => setReady(true)} onError={() => setLoadError(true)} />
        </ReactCrop>
      </div>
      {loadError && <p className="feedback error" role="alert">L’aperçu ne s’est pas chargé. Annulez puis rouvrez le recadrage.</p>}
      <div className="resize-section">
        <div className="resize-heading"><h3>Dimensions de l’image</h3><span><LockKeyhole aria-hidden="true" />Proportions conservées</span></div>
        <div className="resize-fields">
          <div><label htmlFor="image-width">Largeur</label><div className="dimension-input"><Input id="image-width" type="number" inputMode="numeric" min={1} max={geometry.maxWidth} step={1} value={draft?.axis === 'width' ? draft.text : geometry.outputWidth} onChange={event => changeDimension('width', event.target.value)} onBlur={() => { if (!invalidSize) setDraft(null); }} aria-invalid={invalidSize && draft?.axis === 'width'} aria-describedby="dimension-help" /><span>px</span></div></div>
          <div><label htmlFor="image-height">Hauteur</label><div className="dimension-input"><Input id="image-height" type="number" inputMode="numeric" min={1} max={geometry.maxHeight} step={1} value={draft?.axis === 'height' ? draft.text : geometry.outputHeight} onChange={event => changeDimension('height', event.target.value)} onBlur={() => { if (!invalidSize) setDraft(null); }} aria-invalid={invalidSize && draft?.axis === 'height'} aria-describedby="dimension-help" /><span>px</span></div></div>
        </div>
        <p id="dimension-help" className={invalidSize ? 'dimension-help invalid' : 'dimension-help'}>{invalidSize ? `Saisissez un nombre entier entre 1 et ${draftMax}.` : `Maximum : ${geometry.maxWidth} × ${geometry.maxHeight} px.`}</p>
      </div>
      <div className="crop-actions">
        <Button variant="ghost" className="action crop-reset" onClick={reset}><RotateCcw />Image entière</Button>
        <div><Button variant="outline" className="action" onClick={onCancel}>Annuler</Button><Button className="action" disabled={!ready || loadError || invalidSize} onClick={() => onApply({ crop: { ...crop }, scale: geometry.effectiveScale })}><Check />Appliquer</Button></div>
      </div>
    </DialogContent>
  </Dialog>;
}
