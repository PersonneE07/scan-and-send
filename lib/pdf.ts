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

export async function combinePages(pages: Blob[], signal?: AbortSignal, locale: 'fr' | 'en' = 'fr'): Promise<Blob> {
  signal?.throwIfAborted();
  if (!pages.length) throw new Error('Ajoutez au moins une page.');
  const { PDFDocument } = await import('pdf-lib');
  const document = await PDFDocument.create();
  document.setTitle(locale === 'en' ? 'Scanned document' : 'Document numérisé'); document.setCreator('Scan and Send'); document.setLanguage(locale === 'en' ? 'en' : 'fr-FR');
  for (const blob of pages) {
    signal?.throwIfAborted();
    const source = await PDFDocument.load(await blob.arrayBuffer());
    const copied = await document.copyPages(source, source.getPageIndices());
    signal?.throwIfAborted();
    for (const page of copied) document.addPage(page);
  }
  const bytes = await document.save();
  signal?.throwIfAborted();
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}
