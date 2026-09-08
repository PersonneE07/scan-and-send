import type { PixelTask } from './pixel-task.ts';
let workerUnavailable = false;
// A dedicated worker per active operation isolates cancellation: terminate frees
// its pixel buffers immediately, without waiting for a long loop to yield.
export async function processPixels(task: PixelTask, signal?: AbortSignal): Promise<Uint8ClampedArray> {
  signal?.throwIfAborted();
  if (typeof Worker !== 'undefined' && !workerUnavailable) {
    try {
      return await new Promise<Uint8ClampedArray>((resolve, reject) => {
        const worker = new Worker(new URL('../workers/image.worker.ts', import.meta.url), { type: 'module' });
        let settled = false;
        const finish = (error?: unknown, pixels?: Uint8ClampedArray) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout); signal?.removeEventListener('abort', abort); worker.terminate();
          if (error) reject(error); else resolve(pixels!);
        };
        const abort = () => finish(signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
        const timeout = setTimeout(() => finish(new Error('Image worker timeout')), 30000);
        signal?.addEventListener('abort', abort, { once: true });
        worker.onerror = () => finish(new Error('Image worker unavailable'));
        worker.onmessageerror = () => finish(new Error('Invalid worker message'));
        worker.onmessage = ({ data }: MessageEvent<{ pixels?: Uint8ClampedArray; error?: string }>) => {
          if (data.pixels instanceof Uint8ClampedArray) finish(undefined, data.pixels);
          else finish(new Error(data.error ?? 'Invalid worker result'));
        };
        // Keep the original input intact for fallback if the browser rejects workers.
        try { worker.postMessage(task); } catch (error) { finish(error); }
      });
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof Error && error.name === 'AbortError') throw error;
      workerUnavailable = true;
    }
  }
  const { executePixelTask } = await import('./pixel-task.ts');
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  return executePixelTask(task, signal, true);
}
