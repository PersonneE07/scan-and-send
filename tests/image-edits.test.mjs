import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { cloneImageEdits, cropCorners, defaultImageEdits, editorPreview, imageGeometry, perspectiveTransform, renderDocument, rotateCrop, rotateImageEdits, validCorners } from '../lib/document.ts';

function useCanvas(t) {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => createCanvas(1, 1) };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
}

function coloredPhoto() {
  const canvas = createCanvas(320, 240), context = canvas.getContext('2d');
  for (const [color, x, y, width, height] of [
    ['red', 0, 0, 160, 160], ['blue', 160, 0, 160, 160],
    ['lime', 0, 160, 160, 80], ['yellow', 160, 160, 160, 80],
  ]) { context.fillStyle = color; context.fillRect(x, y, width, height); }
  return canvas;
}

async function decode(blob) {
  const image = await loadImage(Buffer.from(await blob.arrayBuffer()));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
  return { width: image.width, height: image.height, pixels: context.getImageData(0, 0, image.width, image.height).data };
}

function embeddedImage(pdf) {
  return pdf.context.enumerateIndirectObjects().map(([, value]) => value).find(value => value instanceof PDFRawStream && value.dict.get(PDFName.of('Subtype'))?.toString() === '/Image');
}

test('crop and proportional resizing use oriented dimensions and enforce the image limit', () => {
  const edits = { crop: { unit: '%', x: 10, y: 20, width: 50, height: 60 }, scale: .5 };
  const geometry = imageGeometry(2000, 1000, 0, edits);
  assert.deepEqual([geometry.cropX, geometry.cropY, geometry.cropWidth, geometry.cropHeight, geometry.outputWidth, geometry.outputHeight], [200, 200, 1000, 600, 500, 300]);
  const rotated = imageGeometry(2000, 1000, 90, { ...edits, crop: rotateCrop(edits.crop) });
  assert.deepEqual([rotated.cropX, rotated.cropY, rotated.outputWidth, rotated.outputHeight], [200, 200, 300, 500]);
  const enlarged = imageGeometry(2000, 1000, 0, { ...edits, scale: 100 });
  assert.deepEqual([enlarged.outputWidth, enlarged.outputHeight], [2200, 1320]);
  const fractional = imageGeometry(319, 241, 0, { crop: { unit: '%', x: 99.8, y: 99.8, width: .2, height: .2 }, scale: .5 });
  assert.deepEqual([fractional.outputWidth, fractional.outputHeight], [1, 1]);
  for (const edit of [
    { ...edits, scale: 0 }, { ...edits, scale: NaN },
    { ...edits, crop: { ...edits.crop, x: -1 } },
    { ...edits, crop: { ...edits.crop, width: 100 } },
    { ...edits, crop: { ...edits.crop, height: 0 } },
  ]) assert.throws(() => imageGeometry(320, 240, 0, edit));
});

test('actual canvas cropping, resizing and all rotations preserve the selected pixels in preview and PDF', async t => {
  useCanvas(t);
  const source = coloredPhoto();
  const originalBytes = source.toBuffer('image/png');
  let crop = { unit: '%', x: 12.5, y: 25, width: 62.5, height: 50 };
  const samples = [
    { x: 10, y: 10, color: [255, 0, 0] }, { x: 90, y: 10, color: [0, 0, 255] },
    { x: 10, y: 55, color: [0, 255, 0] }, { x: 90, y: 55, color: [255, 255, 0] },
  ];
  for (const rotation of [0, 90, 180, 270]) {
    const result = await renderDocument(source, 'color', rotation, 50, undefined, { crop, scale: .5 });
    const preview = await decode(result.previewBlob);
    assert.deepEqual([preview.width, preview.height], rotation % 180 ? [60, 100] : [100, 60]);
    for (const { x, y, color } of samples) {
      const [rx, ry] = rotation === 0 ? [x, y] : rotation === 90 ? [59 - y, x] : rotation === 180 ? [99 - x, 59 - y] : [y, 99 - x];
      const actual = preview.pixels.subarray((ry * preview.width + rx) * 4, (ry * preview.width + rx) * 4 + 3);
      assert.ok(actual.every((value, index) => Math.abs(value - color[index]) < 15), `Selected color at rotation ${rotation}: ${actual}`);
    }
    const pdf = await PDFDocument.load(await result.pdfBlob.arrayBuffer());
    const image = embeddedImage(pdf);
    assert.equal(image.dict.get(PDFName.of('Width')).asNumber(), preview.width);
    assert.equal(image.dict.get(PDFName.of('Height')).asNumber(), preview.height);
    assert.deepEqual(Buffer.from(image.getContents()), Buffer.from(await result.previewBlob.arrayBuffer()));
    crop = rotateCrop(crop);
  }
  assert.deepEqual(crop, { unit: '%', x: 12.5, y: 25, width: 62.5, height: 50 });
  assert.deepEqual(source.toBuffer('image/png'), originalBytes, 'Original pixels stay available for future edits');
  const restored = await renderDocument(source, 'color', 0, 50, undefined, defaultImageEdits());
  const full = await decode(restored.previewBlob);
  assert.deepEqual([full.width, full.height], [320, 240], 'Image entière restores the original dimensions');
});

test('black and white contrast runs on the resized crop and the saved PDF contains those exact pixels', async t => {
  useCanvas(t);
  const source = coloredPhoto();
  const result = await renderDocument(source, 'bw', 90, 100, undefined, { crop: { unit: '%', x: 25, y: 25, width: 50, height: 50 }, scale: .5 });
  const preview = await decode(result.previewBlob);
  assert.deepEqual([preview.width, preview.height], [60, 80]);
  const rgb = Buffer.from(Array.from(preview.pixels).filter((_, index) => index % 4 !== 3));
  assert.ok(rgb.every(value => value === 0 || value === 255));
  const pdf = await PDFDocument.load(await result.pdfBlob.arrayBuffer());
  assert.deepEqual(inflateSync(embeddedImage(pdf).getContents()), rgb);
});

test('the crop editor displays the entire oriented photo while retaining its full working dimensions', async t => {
  useCanvas(t);
  const source = createCanvas(2200, 1100);
  const context = source.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 2200, 1100);
  context.fillStyle = 'red'; context.fillRect(0, 0, 1100, 1100);
  const result = await editorPreview(source, 90);
  assert.deepEqual([result.width, result.height], [1100, 2200]);
  const preview = await decode(result.blob);
  assert.deepEqual([preview.width, preview.height], [600, 1200]);
  assert.ok(preview.pixels[(100 * 600 + 300) * 4 + 1] < 10, 'The left half becomes the top after rotation');
  assert.ok(preview.pixels[(1000 * 600 + 300) * 4 + 1] > 245);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(editorPreview(source, 0, controller.signal), { name: 'AbortError' });
});

test('four free corners reject crossing, concave, collapsed and out of bounds frames', () => {
  const full = cropCorners(defaultImageEdits().crop);
  assert.ok(validCorners(full));
  for (const corners of [
    [full[0], full[2], full[1], full[3]],
    [full[0], full[1], { x: 20, y: 20 }, full[3]],
    [full[0], full[0], full[2], full[3]],
    [{ x: -1, y: 0 }, ...full.slice(1)],
    [{ x: NaN, y: 0 }, ...full.slice(1)],
    [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: .00001 }, { x: 0, y: .00001 }],
  ]) {
    assert.equal(validCorners(corners), false);
    assert.throws(() => imageGeometry(300, 200, 0, { ...defaultImageEdits(), corners }));
  }
  const edits = { ...defaultImageEdits(), corners: full };
  const draft = cloneImageEdits(edits); draft.corners[0].x = 10;
  assert.equal(edits.corners[0].x, 0, 'Draft edits cannot mutate the committed photo');
});

test('perspective transform maps all four corners for a trapezoid and an inclined rectangle', () => {
  for (const points of [
    [{ x: 80, y: 40 }, { x: 240, y: 40 }, { x: 280, y: 200 }, { x: 40, y: 200 }],
    [{ x: 100, y: 20 }, { x: 260, y: 100 }, { x: 220, y: 180 }, { x: 60, y: 100 }],
  ]) {
    const [a, b, c, d, e, f, g, h] = perspectiveTransform(points);
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], index) => {
      const denominator = g * u + h * v + 1;
      assert.ok(Math.abs((a * u + b * v + c) / denominator - points[index].x) < 1e-8);
      assert.ok(Math.abs((d * u + e * v + f) / denominator - points[index].y) < 1e-8);
    });
  }
});

test('free corners covering the full image preserve every pixel, including a one-pixel image', async t => {
  useCanvas(t);
  const narrow = createCanvas(1, 20), context = narrow.getContext('2d');
  context.fillStyle = 'blue'; context.fillRect(0, 0, 1, 20);
  const create = globalThis.document.createElement;
  let rawPixels;
  globalThis.document.createElement = () => {
    const canvas = create(), toBlob = canvas.toBlob.bind(canvas);
    canvas.toBlob = (...args) => {
      rawPixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return toBlob(...args);
    };
    return canvas;
  };
  for (const source of [coloredPhoto(), narrow]) {
    const expected = source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
    const perspective = await renderDocument(source, 'color', 0, 50, undefined, { ...defaultImageEdits(), corners: cropCorners(defaultImageEdits().crop) });
    // Compare pixels before lossy JPEG compression, independently of drawImage's filtering.
    assert.ok(Buffer.from(rawPixels).equals(Buffer.from(expected)), 'Identity must preserve every source pixel before encoding');
    const actual = await decode(perspective.previewBlob);
    assert.deepEqual([actual.width, actual.height], [source.width, source.height]);
  }
});

// An independent analytic trapezoid fixture. Red/green encode the original
// document coordinates; after rectification both gradients must be linear.
function perspectivePhoto() {
  const source = createCanvas(320, 240), context = source.getContext('2d');
  const data = context.createImageData(320, 240);
  for (let y = 0; y < 240; y++) for (let x = 0; x < 320; x++) {
    const cy = y + .5, cx = x + .5;
    const u = (cx - (90 - cy / 4)) / (140 + cy / 2);
    const v = (3 * cy - 120) / (280 + cy);
    const color = u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [20 + 200 * u, 20 + 200 * v, 80, 255] : [250, 0, 250, 255];
    data.data.set(color, (y * 320 + x) * 4);
  }
  context.putImageData(data, 0, 0);
  return source;
}

test('a photographed trapezoid is actually straightened, resized and saved with the same colors after every rotation', async t => {
  useCanvas(t);
  const source = perspectivePhoto(), original = source.toBuffer('image/png');
  let edits = { ...defaultImageEdits(), scale: .6, corners: [{ x: 25, y: 100 / 6 }, { x: 75, y: 100 / 6 }, { x: 87.5, y: 250 / 3 }, { x: 12.5, y: 250 / 3 }] };
  for (const rotation of [0, 90, 180, 270]) {
    const result = await renderDocument(source, 'color', rotation, 50, undefined, edits);
    const preview = await decode(result.previewBlob);
    assert.deepEqual([preview.width, preview.height], rotation % 180 ? [99, 144] : [144, 99]);
    for (const fractionX of [.15, .4, .8]) for (const fractionY of [.15, .4, .8]) {
      const x = Math.floor(preview.width * fractionX), y = Math.floor(preview.height * fractionY);
      const u = (x + .5) / preview.width, v = (y + .5) / preview.height;
      const [originalU, originalV] = rotation === 0 ? [u, v] : rotation === 90 ? [v, 1 - u] : rotation === 180 ? [1 - u, 1 - v] : [1 - v, u];
      const expected = [20 + 200 * originalU, 20 + 200 * originalV, 80];
      const actual = preview.pixels.subarray((y * preview.width + x) * 4, (y * preview.width + x) * 4 + 3);
      assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) < 4), `Perspective must straighten the texture at ${rotation}°: ${actual} vs ${expected}`);
    }
    const pdf = await PDFDocument.load(await result.pdfBlob.arrayBuffer());
    const image = embeddedImage(pdf);
    assert.equal(image.dict.get(PDFName.of('Width')).asNumber(), preview.width);
    assert.equal(image.dict.get(PDFName.of('Height')).asNumber(), preview.height);
    assert.deepEqual(Buffer.from(image.getContents()), Buffer.from(await result.previewBlob.arrayBuffer()));
    edits = rotateImageEdits(edits);
  }
  assert.deepEqual(source.toBuffer('image/png'), original, 'The full photo remains intact for undo/re-editing');
});

test('perspective correction also saves exactly the selected black and white rendering', async t => {
  useCanvas(t);
  const result = await renderDocument(perspectivePhoto(), 'bw', 0, 100, undefined, { ...defaultImageEdits(), corners: [{ x: 25, y: 100 / 6 }, { x: 75, y: 100 / 6 }, { x: 87.5, y: 250 / 3 }, { x: 12.5, y: 250 / 3 }] });
  const preview = await decode(result.previewBlob);
  const rgb = Buffer.from(Array.from(preview.pixels).filter((_, index) => index % 4 !== 3));
  assert.ok(rgb.every(value => value === 0 || value === 255));
  assert.ok(rgb.includes(0) && rgb.includes(255));
  const pdf = await PDFDocument.load(await result.pdfBlob.arrayBuffer());
  assert.deepEqual(inflateSync(embeddedImage(pdf).getContents()), rgb);
});

test('cancelling between perspective row batches prevents encoding and PDF creation', async t => {
  useCanvas(t);
  const source = coloredPhoto(), original = source.toBuffer('image/png');
  const create = globalThis.document.createElement;
  let encodings = 0;
  globalThis.document.createElement = () => {
    const canvas = create(), toBlob = canvas.toBlob.bind(canvas);
    canvas.toBlob = (...args) => { encodings++; return toBlob(...args); };
    return canvas;
  };
  const controller = new AbortController();
  const pending = renderDocument(source, 'color', 0, 50, controller.signal, { ...defaultImageEdits(), corners: cropCorners(defaultImageEdits().crop) });
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(encodings, 0);
  assert.deepEqual(source.toBuffer('image/png'), original);
});
