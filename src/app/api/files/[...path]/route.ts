import { ApiError, protectedRoute } from '@/lib/server/api';
import { store } from '@/lib/server/store';

type Ctx = { params: Promise<{ path: string[] }> };

const SAFE = /^(attachments|avatars|spaces|pages)\/[A-Za-z0-9._\-/]+$/;

/**
 * Entrega um arquivo armazenado somente após validar a sessão.
 *   ?download=<nome> → força o download
 *   ?view=1          → exibe HTML/SVG dentro do ORBE, isolado (CSP sandbox)
 */
export const GET = protectedRoute<Ctx>(async (req, { params }) => {
  const p = (await params).path.join('/');
  if (!SAFE.test(p) || p.includes('..')) throw new ApiError(400, 'Caminho inválido.');
  const download = req.nextUrl.searchParams.get('download') ?? undefined;
  const view = req.nextUrl.searchParams.get('view') === '1';
  return store().fileResponse(p, { download: download?.slice(0, 255), view });
});
