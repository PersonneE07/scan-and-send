import { blackAndWhite, blackAndWhiteCooperative, perspectivePixels } from './image-pixels.ts';
import type { CropCorners } from './image-geometry.ts';
export type PixelTask = { pixels: Uint8ClampedArray; width: number; height: number } & (
  { kind: 'bw'; contrast: number } |
  { kind: 'perspective'; outputWidth: number; outputHeight: number; rotation: number; corners: CropCorners }
);
export async function executePixelTask(task: PixelTask, signal?: AbortSignal, cooperative = false): Promise<Uint8ClampedArray> {
  signal?.throwIfAborted();
  if (task.kind === 'bw') {
    if (cooperative) await blackAndWhiteCooperative(task.pixels, task.width, task.height, task.contrast, signal);
    else blackAndWhite(task.pixels, task.width, task.height, task.contrast);
    signal?.throwIfAborted();
    return task.pixels;
  }
  return perspectivePixels(task.pixels, task.width, task.height, task.outputWidth, task.outputHeight, task.rotation, task.corners, signal);
}
