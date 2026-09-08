import { DEFAULT_CONTRAST, cloneImageEdits, defaultImageEdits, type ImageEdits, type RenderMode } from './image-geometry.ts';
export type Settings = { mode: RenderMode; rotation: number; contrast: number; edits: ImageEdits };
export type ScanPage = { id: number; photo: Blob; settings: Settings; pdfBlob: Blob | null; preview: string; previewBlob: Blob };
export const newSettings = (mode: RenderMode = 'bw'): Settings => ({ mode, rotation: 0, contrast: DEFAULT_CONTRAST, edits: defaultImageEdits() });
export const copySettings = (settings: Settings): Settings => ({ ...settings, edits: cloneImageEdits(settings.edits) });
