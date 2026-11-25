import type { MetadataRoute } from 'next';

/** Torna o ORBE instalável (ícone na tela, janela própria). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ORBE',
    short_name: 'ORBE',
    description: 'Seu universo pessoal de organização, escrita e conhecimento.',
    lang: 'pt-BR',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#07080c',
    theme_color: '#07080c',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
