import { DEFAULT_CONTRAST, perspectiveTransform, type CropCorners } from './image-geometry.ts';

function* blackAndWhiteSteps(pixels: Uint8ClampedArray, width: number, height: number, contrast = DEFAULT_CONTRAST): Generator<void> {
  if (pixels.length !== width * height * 4 || width < 1 || height < 1) throw new Error('Dimensions invalides.');
  if (!Number.isFinite(contrast) || contrast < 0 || contrast > 100) throw new Error('Le contraste doit être compris entre 0 et 100.');
  const adjustment = (contrast - DEFAULT_CONTRAST) / 50;
  const gray = new Uint8Array(width * height);
  const stride = width + 1;
  const integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    if (y % 64 === 0) yield;
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
    if (y % 64 === 0) yield;
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

export function blackAndWhite(pixels: Uint8ClampedArray, width: number, height: number, contrast = DEFAULT_CONTRAST): void {
  const steps = blackAndWhiteSteps(pixels, width, height, contrast);
  while (!steps.next().done) { /* Synchronous execution inside the worker. */ }
}
export async function blackAndWhiteCooperative(pixels: Uint8ClampedArray, width: number, height: number, contrast: number, signal?: AbortSignal) {
  const steps = blackAndWhiteSteps(pixels, width, height, contrast);
  while (!steps.next().done) {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    signal?.throwIfAborted();
  }
}

export async function perspectivePixels(input: Uint8ClampedArray, width: number, height: number, outputWidth: number, outputHeight: number, rotation: number, corners: CropCorners, signal?: AbortSignal) {
  const turn = ((rotation % 360) + 360) % 360;
  const orientedWidth = turn % 180 ? height : width, orientedHeight = turn % 180 ? width : height;
  const points = corners.map(p => {
    const x = p.x * orientedWidth / 100, y = p.y * orientedHeight / 100;
    // Map boundary coordinates back to the immutable, unrotated source.
    return turn === 90 ? { x: y, y: height - x } : turn === 180 ? { x: width - x, y: height - y } : turn === 270 ? { x: width - y, y: x } : { x, y };
  }) as CropCorners;
  const [a, b, c, d, e, f, g, h] = perspectiveTransform(points);
  const pixels = new Uint8ClampedArray(outputWidth * outputHeight * 4);
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
  return pixels;
}
