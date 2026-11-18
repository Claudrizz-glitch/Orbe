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

export const MAX_ATTACHMENT = 25 * 1024 * 1024;  // por arquivo
export const MAX_CHUNK = 3.5 * 1024 * 1024;      // por requisição (Vercel aceita ~4,5 MB)
