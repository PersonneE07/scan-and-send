/* eslint-disable nextjs/no-sync-scripts -- Tiny same-origin theme bootstrap must run before paint to avoid a light-theme flash. */
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PreferencesProvider } from '@/components/preferences';

export const metadata: Metadata = {
  title: 'Scan and Send — Photo en PDF',
  description: 'Prenez votre document en photo, choisissez le rendu et enregistrez votre PDF sur votre téléphone.',
  applicationName: 'Scan and Send',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/favicon.svg',
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: { capable: true, title: 'Scan and Send', statusBarStyle: 'default' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f5f7fa' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr" suppressHydrationWarning><head><script src="/preferences-init.js" /></head><body><PreferencesProvider>{children}</PreferencesProvider></body></html>;
}
