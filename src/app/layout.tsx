import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';
import '@/styles/app.css';

export const metadata: Metadata = {
  title: 'ORBE',
  description: 'Seu universo pessoal de organização, escrita e conhecimento.',
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0c0e16' },
    { media: '(prefers-color-scheme: light)', color: '#f4f3fa' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
