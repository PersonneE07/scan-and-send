import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { defaultImageEdits, editorPreview, imageGeometry, renderDocument, rotateCrop } from '../lib/document.ts';

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
