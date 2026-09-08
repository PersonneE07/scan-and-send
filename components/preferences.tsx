"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { PREFERENCES_KEY, readPreferences, translate, type Locale, type Theme } from '@/lib/i18n';

type Preferences = { locale: Locale; theme: Theme; setLocale: (locale: Locale) => void; setTheme: (theme: Theme) => void; t: (text: string, values?: Record<string, string | number>) => string };
const Context = createContext<Preferences | null>(null);
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<{ locale: Locale; theme: Theme }>({ locale: 'fr', theme: 'light' });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const storage = { getItem: (key: string) => window.localStorage.getItem(key) };
    // Device preferences are read once after hydration to keep the server HTML consistent.
    // eslint-disable-next-line react/react-compiler
    setPreferences(readPreferences(storage, navigator.language, window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false));
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const { locale, theme } = preferences;
    document.documentElement.lang = locale;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.title = translate(locale, 'Scan and Send — Photo en PDF');
    document.querySelector('meta[name="description"]')?.setAttribute('content', translate(locale, 'Prenez votre document en photo, choisissez le rendu et enregistrez votre PDF sur votre téléphone.'));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101722' : '#f5f7fa');
    document.querySelector('link[rel="manifest"]')?.setAttribute('href', locale === 'en' ? '/manifest.en.webmanifest' : '/manifest.webmanifest');
    try { window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch { /* Preferences still work without storage. */ }
  }, [preferences, ready]);
  const setLocale = useCallback((locale: Locale) => setPreferences(previous => ({ ...previous, locale })), []);
  const setTheme = useCallback((theme: Theme) => setPreferences(previous => ({ ...previous, theme })), []);
  const t = useCallback((text: string, values?: Record<string, string | number>) => translate(preferences.locale, text, values), [preferences.locale]);
  return <Context.Provider value={{ ...preferences, setLocale, setTheme, t }}>{children}</Context.Provider>;
}
export function usePreferences() {
  const value = useContext(Context);
  if (!value) throw new Error('PreferencesProvider is required');
  return value;
}
export function PreferenceControls() {
  const { locale, theme, setLocale, setTheme, t } = usePreferences();
  const themeLabel = t(theme === 'dark' ? 'Thème clair' : 'Thème sombre');
  return <div className="preference-controls">
    <select aria-label={t('Langue')} value={locale} onChange={event => setLocale(event.target.value === 'en' ? 'en' : 'fr')}>
      <option value="fr" lang="fr">Français</option><option value="en" lang="en">English</option>
    </select>
    <button type="button" className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={themeLabel} title={themeLabel}>
      {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  </div>;
}
