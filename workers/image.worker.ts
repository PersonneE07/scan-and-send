import { executePixelTask, type PixelTask } from '../lib/pixel-task.ts';
const scope = self as unknown as { onmessage: ((event: MessageEvent<PixelTask>) => void) | null; postMessage: (value: unknown, transfer?: Transferable[]) => void };
scope.onmessage = async ({ data }) => {
  try {
    const pixels = await executePixelTask(data);
    scope.postMessage({ pixels }, [pixels.buffer]);
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : 'Le document n’a pas pu être créé. Réessayez sur cette page.' });
  }
};
