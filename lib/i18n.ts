import translations from './translations.json' with { type: 'json' };
export type Locale = 'fr' | 'en';
export type Theme = 'light' | 'dark';
export const PREFERENCES_KEY = 'scan-and-send.preferences.v1';
export function translate(locale: Locale, source: string, values: Record<string, string | number> = {}): string {
  const text = locale === 'en' ? (translations as Record<string, string>)[source] ?? source : source;
  return text.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
}
export function translateMessage(locale: Locale, source: string): string {
  const page = source.match(/^La page (\d+) doit être préparée\. Sélectionnez-la pour réessayer\.$/);
  if (page) return translate(locale, 'La page {page} doit être préparée. Sélectionnez-la pour réessayer.', { page: page[1] });
  const limit = source.match(/^Un document peut contenir au maximum (\d+) pages\.$/);
  if (limit) return translate(locale, 'Un document peut contenir au maximum {max} pages.', { max: limit[1] });
  return translate(locale, source);
}
export function readPreferences(storage: Pick<Storage, 'getItem'>, browserLanguage: string, prefersDark: boolean): { locale: Locale; theme: Theme } {
  const defaults: { locale: Locale; theme: Theme } = { locale: browserLanguage.toLowerCase().startsWith('fr') ? 'fr' : 'en', theme: prefersDark ? 'dark' : 'light' };
  try {
    const saved: unknown = JSON.parse(storage.getItem(PREFERENCES_KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      const data = saved as Record<string, unknown>;
      if (data.locale === 'fr' || data.locale === 'en') defaults.locale = data.locale;
      if (data.theme === 'light' || data.theme === 'dark') defaults.theme = data.theme;
    }
  } catch { /* Private browsing or invalid saved settings: use device preferences. */ }
  return defaults;
}
