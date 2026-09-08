export function safeFilename(value: string): string {
  // Remove control and bidi characters deliberately from download names.
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069/\\:*?"<>|]/g, '-').trim().replace(/(?:\.pdf)+$/i, '').replace(/[. ]+$/g, '').slice(0, 90);
  return `${clean || 'Mon document'}.pdf`;
}
