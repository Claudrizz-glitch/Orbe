import 'server-only';

/** Identifica imagens pelos primeiros bytes (não confia no nome nem no tipo enviado). */
export function sniffImage(b: Uint8Array): { ext: string; type: string } | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', type: 'image/png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { ext: 'gif', type: 'image/gif' };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { ext: 'webp', type: 'image/webp' };
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 && b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 && b[11] === 0x66) return { ext: 'avif', type: 'image/avif' };
  return null;
}

/** Tipo final de um anexo: imagens só se a assinatura confirmar; SVG/HTML nunca como imagem/página. */
export function attachmentType(claimed: string, firstBytes: Uint8Array): string {
  const img = sniffImage(firstBytes);
  if (img) return img.type;
  const t = claimed.toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(t)) return 'application/octet-stream';
  if (t.startsWith('image/')) return t === 'image/svg+xml' ? 'image/svg+xml' : 'application/octet-stream';
  if (t.includes('html') || t.includes('javascript') || t === 'application/xhtml+xml') return 'application/octet-stream';
  if (b4(firstBytes) === '%PDF') return 'application/pdf';
  return t;
}

const b4 = (b: Uint8Array) => String.fromCharCode(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0);

export function safeName(name: string) {
  const clean = name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(-120);
  return clean || 'arquivo';
}

/**
 * Política aplicada a HTML/SVG exibidos dentro do ORBE: o documento roda numa
 * "origem opaca" — scripts funcionam (páginas interativas), mas NÃO acessam a
 * sessão, os cookies nem a API do ORBE. Vale mesmo se o link for aberto direto.
 */
export const SANDBOX_CSP =
  "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads; frame-ancestors 'self'";

const INLINE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', csv: 'text/plain; charset=utf-8', json: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', svg: 'image/svg+xml',
};

/** Cabeçalhos de entrega de um arquivo armazenado (download, exibição comum ou isolada). */
export function fileHeaders(path: string, storedType: string, size: number | null, opts: { download?: string; view?: boolean }) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const stored = storedType.split(';')[0].trim().toLowerCase();
  const type = INLINE_TYPES[ext] ?? (stored || 'application/octet-stream');
  const risky = /html|svg|xml/.test(type) || ['html', 'htm', 'svg', 'xhtml', 'xml'].includes(ext);
  const headers: Record<string, string> = {
    'Content-Type': risky && !opts.view ? 'application/octet-stream' : type,
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  };
  if (size !== null) headers['Content-Length'] = String(size);
  if (risky && opts.view && !opts.download) {
    headers['Content-Security-Policy'] = SANDBOX_CSP; // exibido, mas isolado
  } else if (opts.download || risky) {
    headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(opts.download ?? path.split('/').pop() ?? 'arquivo')}`;
  }
  return headers;
}

export const MAX_ATTACHMENT = 25 * 1024 * 1024;  // por arquivo
export const MAX_CHUNK = 3.5 * 1024 * 1024;      // por requisição (Vercel aceita ~4,5 MB)
