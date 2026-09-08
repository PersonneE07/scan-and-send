export type RenderMode = 'bw' | 'color';
export const DEFAULT_CONTRAST = 50;
const MAX_EDGE = 2200;

export type CropArea = { unit: '%'; x: number; y: number; width: number; height: number };
export type CropPoint = { x: number; y: number };
// Percent coordinates, clockwise: top left, top right, bottom right, bottom left.
export type CropCorners = [CropPoint, CropPoint, CropPoint, CropPoint];
export type ImageEdits = { crop: CropArea; scale: number; corners?: CropCorners };
export function defaultImageEdits(): ImageEdits {
  return { crop: { unit: '%', x: 0, y: 0, width: 100, height: 100 }, scale: 1 };
}

export function cropCorners(crop: CropArea): CropCorners {
  const right = Math.min(100, crop.x + crop.width), bottom = Math.min(100, crop.y + crop.height);
  return [{ x: crop.x, y: crop.y }, { x: right, y: crop.y }, { x: right, y: bottom }, { x: crop.x, y: bottom }];
}

export function validCorners(corners: CropCorners): boolean {
  if (corners.length !== 4 || corners.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x > 100 || p.y > 100)) return false;
  // Strict convexity prevents crossing edges, collapsed frames and singular transforms.
  return corners.every((a, i) => {
    const b = corners[(i + 1) % 4], c = corners[(i + 2) % 4];
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > .05;
  });
}

export function cloneImageEdits(edits: ImageEdits): ImageEdits {
  return { crop: { ...edits.crop }, scale: edits.scale, ...(edits.corners ? { corners: edits.corners.map(p => ({ ...p })) as CropCorners } : {}) };
}

export function imageGeometry(width: number, height: number, rotation: number, edits = defaultImageEdits()) {
  if (![width, height, rotation].every(Number.isFinite) || width < 1 || height < 1 || rotation % 90 !== 0) throw new Error('Dimensions de la photo invalides.');
  const { crop, scale } = edits;
  if (crop.unit !== '%' || ![crop.x, crop.y, crop.width, crop.height, scale].every(Number.isFinite) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 100.000001 || crop.y + crop.height > 100.000001 || scale <= 0) throw new Error('Choisissez un cadre valide à l’intérieur de la photo.');
  const quarterTurn = Math.abs(rotation % 180) === 90;
  const orientedWidth = quarterTurn ? height : width, orientedHeight = quarterTurn ? width : height;
  const cropX = Math.min(orientedWidth - 1, Math.round(orientedWidth * crop.x / 100));
  const cropY = Math.min(orientedHeight - 1, Math.round(orientedHeight * crop.y / 100));
  let cropWidth = Math.max(1, Math.min(orientedWidth - cropX, Math.round(orientedWidth * crop.width / 100)));
  let cropHeight = Math.max(1, Math.min(orientedHeight - cropY, Math.round(orientedHeight * crop.height / 100)));
  if (edits.corners) {
    if (!validCorners(edits.corners)) throw new Error('Gardez les quatre coins dans la photo, sans croiser les bords.');
    const points = edits.corners.map(p => ({ x: p.x * orientedWidth / 100, y: p.y * orientedHeight / 100 }));
    const edge = (a: number, b: number) => Math.hypot(points[b].x - points[a].x, points[b].y - points[a].y);
    cropWidth = Math.max(1, Math.round(Math.max(edge(0, 1), edge(3, 2))));
    cropHeight = Math.max(1, Math.round(Math.max(edge(0, 3), edge(1, 2))));
  }
  const effectiveScale = Math.min(scale, MAX_EDGE / Math.max(cropWidth, cropHeight));
  return {
    orientedWidth, orientedHeight, cropX, cropY, cropWidth, cropHeight, effectiveScale,
    outputWidth: Math.max(1, Math.round(cropWidth * effectiveScale)),
    outputHeight: Math.max(1, Math.round(cropHeight * effectiveScale)),
    maxWidth: Math.max(1, Math.round(MAX_EDGE * cropWidth / Math.max(cropWidth, cropHeight))),
    maxHeight: Math.max(1, Math.round(MAX_EDGE * cropHeight / Math.max(cropWidth, cropHeight))),
  };
}

export function rotateCrop(crop: CropArea): CropArea {
  return { unit: '%', x: Math.max(0, 100 - crop.y - crop.height), y: crop.x, width: crop.height, height: crop.width };
}

export function rotateImageEdits(edits: ImageEdits): ImageEdits {
  const next = cloneImageEdits(edits);
  next.crop = rotateCrop(next.crop);
  if (next.corners) {
    const rotated = next.corners.map(p => ({ x: 100 - p.y, y: p.x }));
    next.corners = [rotated[3], rotated[0], rotated[1], rotated[2]];
  }
  return next;
}

// Homography from the unit square to a quadrilateral. Sampling this inverse map
// visits every output pixel, so a skewed document becomes a complete rectangle.
export function perspectiveTransform([p0, p1, p2, p3]: CropCorners) {
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(determinant) < 1e-10) throw new Error('Ce cadre est trop aplati. Écartez les coins.');
  const g = (dx3 * dy2 - dx2 * dy3) / determinant;
  const h = (dx1 * dy3 - dx3 * dy1) / determinant;
  if ([1 + g, 1 + h, 1 + g + h].some(value => !Number.isFinite(value) || value < 1e-10)) throw new Error('Ce cadre est trop aplati. Écartez les coins.');
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h];
}

async function drawPerspective(source: HTMLCanvasElement, canvas: HTMLCanvasElement, rotation: number, corners: CropCorners, signal?: AbortSignal) {
  const turn = ((rotation % 360) + 360) % 360;
  const width = source.width, height = source.height;
  const orientedWidth = turn % 180 ? height : width, orientedHeight = turn % 180 ? width : height;
  const points = corners.map(p => {
    const x = p.x * orientedWidth / 100, y = p.y * orientedHeight / 100;
    // Map boundary coordinates back to the immutable, unrotated source.
    return turn === 90 ? { x: y, y: height - x } : turn === 180 ? { x: width - x, y: height - y } : turn === 270 ? { x: width - y, y: x } : { x, y };
  }) as CropCorners;
  const [a, b, c, d, e, f, g, h] = perspectiveTransform(points);
  const input = getContext(source).getImageData(0, 0, width, height).data;
  const context = getContext(canvas), output = context.createImageData(canvas.width, canvas.height);
  const pixels = output.data, outputWidth = canvas.width, outputHeight = canvas.height;
  for (let y = 0; y < outputHeight; y++) {
    if (y % 64 === 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      signal?.throwIfAborted();
    }
    const v = (y + .5) / outputHeight;
    for (let x = 0; x < outputWidth; x++) {
      const u = (x + .5) / outputWidth, denominator = g * u + h * v + 1;
      const sx = Math.max(0, Math.min(width - 1, (a * u + b * v + c) / denominator - .5));
      const sy = Math.max(0, Math.min(height - 1, (d * u + e * v + f) / denominator - .5));
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
      const fx = sx - x0, fy = sy - y0;
      const p00 = (y0 * width + x0) * 4, p10 = (y0 * width + x1) * 4, p01 = (y1 * width + x0) * 4, p11 = (y1 * width + x1) * 4;
      const target = (y * outputWidth + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        pixels[target + channel] = (input[p00 + channel] * (1 - fx) + input[p10 + channel] * fx) * (1 - fy) + (input[p01 + channel] * (1 - fx) + input[p11 + channel] * fx) * fy;
      }
      pixels[target + 3] = 255;
    }
  }
  context.putImageData(output, 0, 0);
}

export function safeFilename(value: string): string {
  const clean = value.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '-').trim().replace(/(?:\.pdf)+$/i, '').replace(/[. ]+$/g, '').slice(0, 90);
  return `${clean || 'Mon document'}.pdf`;
}

export function blackAndWhite(pixels: Uint8ClampedArray, width: number, height: number, contrast = DEFAULT_CONTRAST): void {
  if (pixels.length !== width * height * 4 || width < 1 || height < 1) throw new Error('Dimensions invalides.');
  if (!Number.isFinite(contrast) || contrast < 0 || contrast > 100) throw new Error('Le contraste doit être compris entre 0 et 100.');
  const adjustment = (contrast - DEFAULT_CONTRAST) / 50;
  const gray = new Uint8Array(width * height);
  const stride = width + 1;
  const integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      const n = y * width + x;
      gray[n] = Math.round(pixels[n * 4] * .299 + pixels[n * 4 + 1] * .587 + pixels[n * 4 + 2] * .114);
      sum += gray[n];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum;
    }
  }
  // Local thresholding keeps text readable in uneven light.
  const radius = Math.max(12, Math.round(Math.min(width, height) / 35));
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius), bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius), right = Math.min(width, x + radius + 1);
      const mean = (integral[bottom * stride + right] - integral[top * stride + right] - integral[bottom * stride + left] + integral[top * stride + left]) / ((bottom - top) * (right - left));
      const n = y * width + x;
      // Adjust faint-stroke sensitivity before binarizing; 50 preserves the original rendering.
      const threshold = Math.min(225 + 20 * adjustment, mean - (10 - 8 * adjustment));
      const value = gray[n] < threshold || gray[n] < 35 + 15 * adjustment ? 0 : 255;
      pixels[n * 4] = pixels[n * 4 + 1] = pixels[n * 4 + 2] = value;
      pixels[n * 4 + 3] = 255;
    }
  }
}

export function a4Placement(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Dimensions invalides.');
  const landscape = width > height;
  const pageWidth = landscape ? 841.89 : 595.28;
  const pageHeight = landscape ? 595.28 : 841.89;
  const scale = Math.min((pageWidth - 28) / width, (pageHeight - 28) / height);
  return { pageWidth, pageHeight, width: width * scale, height: height * scale, x: (pageWidth - width * scale) / 2, y: (pageHeight - height * scale) / 2 };
}

export async function createPdf(imageBytes: Uint8Array, format: 'png' | 'jpg', width: number, height: number): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle('Document numérisé');
  pdf.setCreator('Scan and Send');
  pdf.setLanguage('fr-FR');
  const image = format === 'png' ? await pdf.embedPng(imageBytes) : await pdf.embedJpg(imageBytes);
  const placement = a4Placement(width, height);
  const page = pdf.addPage([placement.pageWidth, placement.pageHeight]);
  page.drawImage(image, placement);
  return pdf.save();
}

function getContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Votre navigateur ne peut pas traiter cette photo. Essayez dans Safari ou Chrome.');
  return context;
}

export async function normalizePhoto(file: File, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  signal?.throwIfAborted();
  if (!file.size) throw new Error('Cette photo est vide. Prenez une nouvelle photo.');
  if (file.size > 40 * 1024 * 1024) throw new Error('Cette photo dépasse 40 Mo. Choisissez une image plus petite.');
  if (!(file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|avif|gif)$/i.test(file.name))) throw new Error('Choisissez une photo, au format JPEG, PNG ou un autre format image.');
  const url = URL.createObjectURL(file);
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
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
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

export async function combinePages(pages: Blob[], signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted();
  if (!pages.length) throw new Error('Ajoutez au moins une page.');
  const { PDFDocument } = await import('pdf-lib');
  const document = await PDFDocument.create();
  document.setTitle('Document numérisé'); document.setCreator('Scan and Send'); document.setLanguage('fr-FR');
  for (const blob of pages) {
    signal?.throwIfAborted();
    const source = await PDFDocument.load(await blob.arrayBuffer());
    const copied = await document.copyPages(source, source.getPageIndices());
    signal?.throwIfAborted();
    for (const page of copied) document.addPage(page);
  }
  const bytes = await document.save();
  signal?.throwIfAborted();
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
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
      await drawPerspective(source, canvas, rotation, edits.corners, signal);
    } else {
      context.scale(canvas.width / geometry.cropWidth, canvas.height / geometry.cropHeight);
      context.translate(-geometry.cropX, -geometry.cropY);
      context.translate(geometry.orientedWidth / 2, geometry.orientedHeight / 2);
      context.rotate(rotation * Math.PI / 180);
      context.drawImage(source, -source.width / 2, -source.height / 2);
    }
    if (mode === 'bw') {
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      blackAndWhite(image.data, canvas.width, canvas.height, contrast);
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
