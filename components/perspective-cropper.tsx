/* eslint-disable nextjs/no-img-element -- Private local blob images cannot use a server image optimizer. */
"use client";
import { usePreferences } from '@/components/preferences';

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { validCorners, type CropCorners, type CropPoint } from '@/lib/document';

const cornerNames = ['Coin supérieur gauche', 'Coin supérieur droit', 'Coin inférieur droit', 'Coin inférieur gauche'];
const clamp = (value: number) => Math.max(0, Math.min(100, value));

type Props = {
  image: { url: string; width: number; height: number };
  corners: CropCorners;
  onChange: (corners: CropCorners) => void;
  onLoad: () => void;
  onError: () => void;
};

export function PerspectiveCropper({ image, corners, onChange, onLoad, onError }: Props) {
  const { t } = usePreferences();
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; pointerId: number; x: number; y: number; point: CropPoint } | null>(null);
  const [blocked, setBlocked] = useState(false);
  const helpId = useId();

  const moveCorner = (index: number, point: CropPoint) => {
    const next = corners.map((p, i) => i === index ? { x: clamp(point.x), y: clamp(point.y) } : p) as CropCorners;
    const valid = validCorners(next);
    setBlocked(!valid);
    if (valid) onChange(next);
  };

  const pointerDown = (event: PointerEvent<HTMLButtonElement>, index: number) => {
    if (event.button !== 0 || !event.isPrimary || drag.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { index, pointerId: event.pointerId, x: event.clientX, y: event.clientY, point: { ...corners[index] } };
  };

  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = drag.current, rect = surface.current?.getBoundingClientRect();
    if (!gesture || gesture.pointerId !== event.pointerId || !rect?.width || !rect.height) return;
    event.preventDefault();
    moveCorner(gesture.index, { x: gesture.point.x + (event.clientX - gesture.x) * 100 / rect.width, y: gesture.point.y + (event.clientY - gesture.y) * 100 / rect.height });
  };

  const pointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.shiftKey ? 2 : .5;
    const direction: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
    if (!direction[event.key]) return;
    event.preventDefault();
    moveCorner(index, { x: corners[index].x + direction[event.key][0], y: corners[index].y + direction[event.key][1] });
  };

  const polygon = corners.map(p => `${p.x},${p.y}`).join(' ');
  const cutout = `M0,0H100V100H0Z M${corners.map(p => `${p.x},${p.y}`).join('L')}Z`;
  const ratio = image.width / image.height;

  return <>
    <div ref={surface} className="perspective-crop" style={{ width: `min(100%, ${ratio * 38}dvh, ${ratio * 360}px)` }}>
      <img src={image.url} alt={t("Photo à redresser")} draggable={false} onLoad={onLoad} onError={onError} />
      <svg className="perspective-outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d={cutout} fill="rgba(0,0,0,.55)" fillRule="evenodd" />
        <polygon points={polygon} fill="none" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      {corners.map((point, index) => <button
        key={index} type="button" className="perspective-corner"
        style={{ left: `${point.x}%`, top: `${point.y}%` }}
        aria-label={`${t(cornerNames[index])} : ${Math.round(point.x)} % horizontal, ${Math.round(point.y)} % vertical`}
        aria-describedby={helpId}
        onPointerDown={event => pointerDown(event, index)} onPointerMove={pointerMove}
        onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={event => keyDown(event, index)}
      ><span aria-hidden="true" /></button>)}
    </div>
    <output id={helpId} className={`perspective-help${blocked ? ' invalid' : ''}`}>
      {blocked ? t("Les bords ne doivent pas se croiser. Écartez ce coin des autres.") : t("Déplacez chaque coin au doigt ou avec les flèches du clavier.")}
    </output>
  </>;
}
