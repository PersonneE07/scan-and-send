export type RenderMode = 'bw' | 'color';
export const DEFAULT_CONTRAST = 50;
export const MAX_PAGES = 20;
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
