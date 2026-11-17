import { ApiError, protectedRoute } from '@/lib/server/api';
import { store } from '@/lib/server/store';

type Ctx = { params: Promise<{ path: string[] }> };

const SAFE = /^(attachments|avatars|spaces)\/[A-Za-z0-9._\-/]+$/;

/**
 * Entrega um arquivo armazenado somente após validar a sessão.
 * Supabase: redireciona para uma URL assinada de 5 minutos.
 * Local: transmite o arquivo da pasta orbe-data/files.
 */
export const GET = protectedRoute<Ctx>(async (req, { params }) => {
  const p = (await params).path.join('/');
  if (!SAFE.test(p) || p.includes('..')) throw new ApiError(400, 'Caminho inválido.');
  const download = req.nextUrl.searchParams.get('download') ?? undefined;
  return store().fileResponse(p, { download: download?.slice(0, 255) });
});
