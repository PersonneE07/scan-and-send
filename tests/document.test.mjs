import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { a4Placement, blackAndWhite, createPdf, normalizePhoto, renderDocument, safeFilename } from '../lib/document.ts';

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const body = Buffer.concat([Buffer.from(type), bytes]);
  const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function png(width, height, pixels) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) rows[y * (width * 3 + 1) + x * 3 + 1 + c] = pixels[(y * width + x) * 4 + c];
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
function imageStreams(pdf) {
  return pdf.context.enumerateIndirectObjects().map(([, value]) => value).filter(value => value instanceof PDFRawStream && value.dict.get(PDFName.of('Subtype'))?.toString() === '/Image');
}

function faintDocument() {
  const width = 160, height = 70, pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const shade = 175 + Math.floor(x * .4);
    pixels.set([shade, shade, shade, 255], (y * width + x) * 4);
  }
  [4, 8, 12, 16, 24, 80, 150].forEach((difference, index) => {
    const x = 20 + index * 20, shade = 175 + Math.floor(x * .4) - difference;
    for (let y = 12; y < 58; y++) pixels.set([shade, shade, shade, 255], (y * width + x) * 4);
  });
  return { width, height, pixels };
}

test('default contrast preserves the previous scan and higher contrast reveals faint strokes', () => {
  const { width, height, pixels } = faintDocument();
  const variants = [0, 50, 100].map(contrast => {
    const output = pixels.slice(); blackAndWhite(output, width, height, contrast); return output;
  });
  // Golden output captured from the previous published algorithm, before adding contrast.
  assert.equal(createHash('sha256').update(variants[1]).digest('hex'), '8e9d82fc24e111f55b58219913bfc511629d4b276dffb20b2648be8afba27ef7');
  const counts = variants.map(output => Array.from(output).filter((value, index) => index % 4 === 0 && value === 0).length);
  assert.ok(counts[0] < counts[1] && counts[1] < counts[2], `Faint strokes must become visible: ${counts}`);
  for (let index = 0; index < pixels.length; index += 4) {
    assert.ok(variants[0][index] >= variants[1][index] && variants[1][index] >= variants[2][index]);
  }
  for (const output of variants) assert.equal(output[(30 * width + 10) * 4], 255, 'Paper background remains white');
});

test('contrast limits keep uniform paper white and reject invalid values', () => {
  for (const contrast of [0, 50, 100]) {
    const pixels = new Uint8ClampedArray(40 * 40 * 4).fill(255);
    blackAndWhite(pixels, 40, 40, contrast);
    assert.ok(pixels.every(value => value === 255));
  }
  for (const contrast of [-1, 101, NaN, Infinity]) assert.throws(() => blackAndWhite(new Uint8ClampedArray(4), 1, 1, contrast), /contraste/);
});

test('the rendered preview and PDF contain the same adjusted black and white pixels', async () => {
  const fixture = faintDocument();
  const previousDocument = globalThis.document;
  let renderedPixels;
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({
      translate() {}, rotate() {}, drawImage() {},
      getImageData: () => ({ data: fixture.pixels.slice() }),
      putImageData: image => { renderedPixels = image.data; },
    }),
    toBlob(callback) { callback(new Blob([png(this.width, this.height, renderedPixels)], { type: 'image/png' })); },
  };
  globalThis.document = { createElement: () => canvas };
  try {
    const pdfPixels = [];
    for (const contrast of [0, 100]) {
      const result = await renderDocument(fixture, 'bw', 0, contrast);
      const previewBytes = Buffer.from(await result.previewBlob.arrayBuffer());
      assert.deepEqual(previewBytes, png(fixture.width, fixture.height, renderedPixels));
      const pdf = await PDFDocument.load(await result.pdfBlob.arrayBuffer());
      const rgb = inflateSync(imageStreams(pdf)[0].getContents());
      assert.deepEqual(rgb, Buffer.from(Array.from(renderedPixels).filter((_, index) => index % 4 !== 3)));
      pdfPixels.push(rgb);
      assert.equal(canvas.width, 0, 'Processing canvas is released');
    }
    assert.notDeepEqual(pdfPixels[0], pdfPixels[1], 'The saved PDF must reflect the selected contrast');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('a superseded render stops after image encoding and releases its canvas', async () => {
  const controller = new AbortController();
  const previousDocument = globalThis.document;
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ translate() {}, rotate() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {} }),
    toBlob(callback) { controller.abort(); callback(new Blob(['invalid image'])); },
  };
  globalThis.document = { createElement: () => canvas };
  try {
    await assert.rejects(renderDocument({ width: 1, height: 1 }, 'bw', 0, 50, controller.signal), { name: 'AbortError' });
    assert.equal(canvas.width, 0);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('download filenames remain usable and have one PDF extension', () => {
  assert.equal(safeFilename('  Facture été.pdf.pdf  '), 'Facture été.pdf');
  assert.equal(safeFilename('  ... '), 'Mon document.pdf');
  assert.equal(safeFilename('facture/2026:09'), 'facture-2026-09.pdf');
  assert.equal(safeFilename(''), 'Mon document.pdf');
  assert.ok(safeFilename('a'.repeat(200)).length <= 94);
});

test('portrait, landscape and extreme aspect ratios fit A4 without cropping or distortion', () => {
  for (const [width, height] of [[1200, 1800], [1800, 1200], [120, 3000], [3000, 120], [100, 100]]) {
    const result = a4Placement(width, height);
    assert.ok(result.x >= 13.999 && result.y >= 13.999);
    assert.ok(result.x + result.width <= result.pageWidth - 13.999);
    assert.ok(result.y + result.height <= result.pageHeight - 13.999);
    assert.ok(Math.abs(result.width / result.height - width / height) < 1e-8);
    assert.equal(result.pageWidth > result.pageHeight, width > height);
  }
  for (const width of [0, -1, NaN, Infinity]) assert.throws(() => a4Placement(width, 50));
});

test('black and white preserves dark lettering across a shaded paper background', () => {
  const width = 100, height = 60;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const shade = 155 + x;
    pixels.set([shade, shade, shade, 255], (y * width + x) * 4);
  }
  for (const x of [15, 75]) for (let y = 15; y < 45; y++) pixels.set([25, 25, 25, 255], (y * width + x) * 4);
  blackAndWhite(pixels, width, height);
  for (let n = 0; n < pixels.length; n += 4) {
    assert.ok(pixels[n] === 0 || pixels[n] === 255);
    assert.equal(pixels[n], pixels[n + 1]); assert.equal(pixels[n], pixels[n + 2]); assert.equal(pixels[n + 3], 255);
  }
  assert.equal(pixels[(30 * width + 15) * 4], 0);
  assert.equal(pixels[(30 * width + 75) * 4], 0);
  assert.equal(pixels[(30 * width + 30) * 4], 255);
  assert.equal(pixels[(30 * width + 90) * 4], 255);
  assert.throws(() => blackAndWhite(new Uint8ClampedArray(3), 1, 1));
});

test('exported PDF reopens with the actual image, its colors and correct page size', async () => {
  const pixels = new Uint8ClampedArray([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255, 0,0,0,255, 120,50,180,255]);
  for (const mode of ['color', 'bw']) {
    const processed = pixels.slice();
    if (mode === 'bw') blackAndWhite(processed, 2, 3);
    const bytes = await createPdf(png(2, 3, processed), 'png', 2, 3);
    assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
    assert.equal(pdf.getTitle(), 'Document numérisé');
    const page = pdf.getPage(0);
    assert.equal(page.getWidth(), 595.28); assert.equal(page.getHeight(), 841.89);
    const streams = imageStreams(pdf);
    assert.equal(streams.length, 1);
    const rgb = inflateSync(streams[0].getContents());
    const expected = Buffer.from(Array.from(processed).filter((_, index) => index % 4 !== 3));
    assert.deepEqual(rgb, expected);
  }
});

test('invalid photos fail clearly before touching browser decoding', async () => {
  await assert.rejects(normalizePhoto(new File([], 'empty.jpg', { type: 'image/jpeg' })), /vide/);
  await assert.rejects(normalizePhoto(new File(['not an image'], 'document.pdf', { type: 'application/pdf' })), /Choisissez une photo/);
});

test('cancelling a pending photo import releases its image and Blob URL immediately', async t => {
  const previousImage = globalThis.Image;
  let image;
  globalThis.Image = class {
    constructor() { image = this; }
    src = '';
    onload = null;
    onerror = null;
  };
  const revoke = t.mock.method(URL, 'revokeObjectURL');
  try {
    const controller = new AbortController();
    const pending = normalizePhoto(new File(['pending photo'], 'photo.jpg', { type: 'image/jpeg' }), controller.signal);
    const photoUrl = image.src;
    assert.ok(photoUrl.startsWith('blob:'));
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(image.src, '');
    assert.equal(image.onload, null);
    assert.equal(image.onerror, null);
    assert.ok(revoke.mock.calls.some(call => call.arguments[0] === photoUrl));
  } finally {
    if (previousImage === undefined) delete globalThis.Image;
    else globalThis.Image = previousImage;
  }
});


test('the color JPEG path preserves the photo bytes in a landscape PDF', async () => {
  const image = await readFile(new URL('./fixtures/color.jpg', import.meta.url));
  const bytes = await createPdf(image, 'jpg', 120, 60);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getPage(0).getWidth(), 841.89);
  assert.equal(pdf.getPage(0).getHeight(), 595.28);
  const streams = imageStreams(pdf);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].dict.get(PDFName.of('Filter')).toString(), '/DCTDecode');
  assert.deepEqual(Buffer.from(streams[0].getContents()), image);
});
