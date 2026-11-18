import { ApiError, protectedRoute } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { SANDBOX_CSP } from '@/lib/server/files';
import { currentItems, injectShim, storageShim } from '@/lib/server/pageState';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Exibe a página do canal, isolada (CSP sandbox), com o localStorage do ORBE
 * injetado — assim o que a página salva fica guardado no ORBE, com histórico.
 */
export const GET = protectedRoute<Ctx>(async (req, { params }) => {
  const id = v.uuid((await params).id);
  const s = store();
  const [ch] = await s.select<{ page_path: string | null }>('channels', { cols: 'page_path', eq: { id } });
  if (!ch) throw new ApiError(404, 'Canal não encontrado.');
  if (!ch.page_path) throw new ApiError(404, 'Este canal ainda não tem página.');
  const file = await s.fileResponse(ch.page_path, { view: true });
  if (!file.ok) throw new ApiError(404, 'Arquivo da página não encontrado.');
  const html = await file.text();

  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host;
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
  const body = injectShim(html, storageShim(await currentItems(id), `${proto}://${host}`));

  return new Response(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': SANDBOX_CSP,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
