import type { Metadata, Viewport } from 'next';
import './globals.css';

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
  return <html lang="fr"><body>{children}</body></html>;
}
