import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Scan and Send — Photo en PDF',
  description: 'Prenez votre document en photo, choisissez le rendu et enregistrez votre PDF sur votre téléphone.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f5f7fa' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}
