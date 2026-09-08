export * from './image-geometry.ts';
export { safeFilename } from './filename.ts';
export { blackAndWhite } from './image-pixels.ts';
export { a4Placement, createPdf, combinePages } from './pdf.ts';
import { DEFAULT_CONTRAST, defaultImageEdits, imageGeometry, type RenderMode } from './image-geometry.ts';
import { createPdf } from './pdf.ts';
import { processPixels } from './pixel-worker-client.ts';

function getContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Votre navigateur ne peut pas traiter cette photo. Essayez dans Safari ou Chrome.');
  return context;
}

export async function normalizePhoto(file: File, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  signal?.throwIfAborted();
  if (!file.size) throw new Error('Cette photo est vide. Prenez une nouvelle photo.');
  if (file.size > 40 * 1024 * 1024) throw new Error('Cette photo dépasse 40 Mo. Choisissez une image plus petite.');
  // Check raster signatures, never trust an extension or a supplied MIME type.
  const header = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  signal?.throwIfAborted();
  const text = (start: number, end: number) => String.fromCharCode(...header.slice(start, end));
  let mime = '';
  if (header[0] === 255 && header[1] === 216 && header[2] === 255) mime = 'image/jpeg';
  else if (header.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10') mime = 'image/png';
  else if (['GIF87a', 'GIF89a'].includes(text(0, 6))) mime = 'image/gif';
  else if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') mime = 'image/webp';
  else if (text(4, 8) === 'ftyp') {
    const brands = [text(8, 12)];
    const boxSize = new DataView(header.buffer).getUint32(0);
    for (let offset = 16; offset + 4 <= Math.min(boxSize, header.length); offset += 4) brands.push(text(offset, offset + 4));
    if (brands.some(brand => ['avif', 'avis'].includes(brand))) mime = 'image/avif';
    else if (brands.some(brand => ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand))) mime = 'image/heif';
  }
  if (!mime) throw new Error('Choisissez une photo JPEG, PNG, WebP, GIF, HEIC ou AVIF.');
  const url = URL.createObjectURL(file.slice(0, file.size, mime));
  const image = new Image();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      onAbort = () => reject(signal?.reason ?? new DOMException('Import annulé.', 'AbortError'));
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => reject(new Error('La photo prend trop de temps à ouvrir. Essayez une image plus petite.')), 20000);
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Cette photo ne peut pas être ouverte ici. Reprenez-la avec l’appareil photo ou importez une image JPEG ou PNG.'));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Cette image est illisible. Choisissez une autre photo.');
    if (image.naturalWidth * image.naturalHeight > 80_000_000) throw new Error('Cette photo dépasse 80 mégapixels. Choisissez une image plus petite.');
    const scale = Math.min(1, 2200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = getContext(canvas);
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    // Browsers apply EXIF orientation while decoding the image.
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    image.onload = null; image.onerror = null; image.src = '';
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('La photo n’a pas pu être préparée. Essayez une image plus petite.')), type, .9));
}

export async function snapshotPhoto(canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted();
  const blob = await canvasBlob(canvas, 'image/png');
  signal?.throwIfAborted();
  return blob;
}

export async function editorPreview(source: HTMLCanvasElement, rotation: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const geometry = imageGeometry(source.width, source.height, rotation);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1200 / Math.max(geometry.orientedWidth, geometry.orientedHeight));
  canvas.width = Math.max(1, Math.round(geometry.orientedWidth * scale));
  canvas.height = Math.max(1, Math.round(geometry.orientedHeight * scale));
  try {
    const context = getContext(canvas);
    context.scale(canvas.width / geometry.orientedWidth, canvas.height / geometry.orientedHeight);
    context.translate(geometry.orientedWidth / 2, geometry.orientedHeight / 2);
    context.rotate(rotation * Math.PI / 180);
    context.drawImage(source, -source.width / 2, -source.height / 2);
    const blob = await canvasBlob(canvas, 'image/jpeg');
    signal?.throwIfAborted();
    return { blob, width: geometry.orientedWidth, height: geometry.orientedHeight };
  } finally { canvas.width = 0; canvas.height = 0; }
}

export async function renderDocument(source: HTMLCanvasElement, mode: RenderMode, rotation: number, contrast = DEFAULT_CONTRAST, signal?: AbortSignal, edits = defaultImageEdits()) {
  signal?.throwIfAborted();
  const geometry = imageGeometry(source.width, source.height, rotation, edits);
  const canvas = document.createElement('canvas');
  canvas.width = geometry.outputWidth;
  canvas.height = geometry.outputHeight;
  try {
    const context = getContext(canvas);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    if (edits.corners) {
      const input = getContext(source).getImageData(0, 0, source.width, source.height);
      const pixels = await processPixels({ kind: 'perspective', pixels: input.data, width: source.width, height: source.height, outputWidth: canvas.width, outputHeight: canvas.height, rotation, corners: edits.corners }, signal);
      const output = context.createImageData(canvas.width, canvas.height);
      output.data.set(pixels); context.putImageData(output, 0, 0);
    } else {
      context.scale(canvas.width / geometry.cropWidth, canvas.height / geometry.cropHeight);
      context.translate(-geometry.cropX, -geometry.cropY);
      context.translate(geometry.orientedWidth / 2, geometry.orientedHeight / 2);
      context.rotate(rotation * Math.PI / 180);
      context.drawImage(source, -source.width / 2, -source.height / 2);
    }
    if (mode === 'bw') {
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      image.data.set(await processPixels({ kind: 'bw', pixels: image.data, width: canvas.width, height: canvas.height, contrast }, signal));
      context.putImageData(image, 0, 0);
    }
    const previewBlob = await canvasBlob(canvas, mode === 'bw' ? 'image/png' : 'image/jpeg');
    signal?.throwIfAborted();
    const encodedImage = new Uint8Array(await previewBlob.arrayBuffer());
    signal?.throwIfAborted();
    const bytes = await createPdf(encodedImage, mode === 'bw' ? 'png' : 'jpg', canvas.width, canvas.height);
    signal?.throwIfAborted();
    const pdfBlob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    return { previewBlob, pdfBlob };
  } finally { canvas.width = 0; canvas.height = 0; }
}
