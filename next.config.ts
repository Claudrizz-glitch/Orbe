import type { NextConfig } from 'next';

const securityHeaders = [
  // O ORBE pode exibir os próprios arquivos em iframes; outros sites não podem embutir o ORBE.
  // ATENÇÃO: não definir Content-Security-Policy aqui — sobrescreveria a política "sandbox"
  // que /api/files aplica aos HTML exibidos (isolamento de scripts).
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
