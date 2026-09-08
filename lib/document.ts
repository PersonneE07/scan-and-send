export type RenderMode = 'bw' | 'color';
const MAX_EDGE = 2200;

export function safeFilename(value: string): string {
  const clean = value.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '-').trim().replace(/(?:\.pdf)+$/i, '').replace(/[. ]+$/g, '').slice(0, 90);
  return `${clean || 'Mon document'}.pdf`;
}

export function blackAndWhite(pixels: Uint8ClampedArray, width: number, height: number): void {
  if (pixels.length !== width * height * 4 || width < 1 || height < 1) throw new Error('Dimensions invalides.');
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
      const value = gray[n] < Math.min(225, mean - 10) || gray[n] < 35 ? 0 : 255;
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

export async function normalizePhoto(file: File): Promise<HTMLCanvasElement> {
  if (!file.size) throw new Error('Cette photo est vide. Prenez une nouvelle photo.');
  if (file.size > 40 * 1024 * 1024) throw new Error('Cette photo dépasse 40 Mo. Choisissez une image plus petite.');
  if (!(file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|avif|gif)$/i.test(file.name))) throw new Error('Choisissez une photo, au format JPEG, PNG ou un autre format image.');
  const url = URL.createObjectURL(file);
  const image = new Image();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
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
    image.onload = null; image.onerror = null; image.src = '';
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('La photo n’a pas pu être préparée. Essayez une image plus petite.')), type, .9));
}

export async function renderDocument(source: HTMLCanvasElement, mode: RenderMode, rotation: number) {
  const canvas = document.createElement('canvas');
  const quarterTurn = rotation % 180 !== 0;
  canvas.width = quarterTurn ? source.height : source.width;
  canvas.height = quarterTurn ? source.width : source.height;
  try {
    const context = getContext(canvas);
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(rotation * Math.PI / 180);
    context.drawImage(source, -source.width / 2, -source.height / 2);
    if (mode === 'bw') {
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      blackAndWhite(image.data, canvas.width, canvas.height);
      context.putImageData(image, 0, 0);
    }
    const previewBlob = await canvasBlob(canvas, mode === 'bw' ? 'image/png' : 'image/jpeg');
    const bytes = await createPdf(new Uint8Array(await previewBlob.arrayBuffer()), mode === 'bw' ? 'png' : 'jpg', canvas.width, canvas.height);
    const pdfBlob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    return { previewBlob, pdfBlob };
  } finally { canvas.width = 0; canvas.height = 0; }
}
