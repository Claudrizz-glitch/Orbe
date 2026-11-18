import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { history, saveItems, validItems } from '@/lib/server/pageState';

type Ctx = { params: Promise<{ id: string }> };

async function pageChannel(id: string) {
  if (!(await store().count('channels', { eq: { id } }))) throw new ApiError(404, 'Canal não encontrado.');
}

/** Estado atual e versões anteriores dos dados salvos pela página. */
export const GET = protectedRoute<Ctx>(async (_req, { params }) => {
  const id = v.uuid((await params).id);
  await pageChannel(id);
  const h = await history(id);
  return json({ items: h[0]?.items ?? {}, history: h });
});

/**
 * Grava os dados da página. Body: { items: {chave: valor}, restore_of?: uuid }
 * restore_of → volta a uma versão anterior (fica registrado no histórico).
 */
export const PUT = protectedRoute<Ctx>(async (req, { params }) => {
  const id = v.uuid((await params).id);
  await pageChannel(id);
  const b = await readBody(req);
  let items = validItems(b.items);
  let note: string | undefined;
  if (b.restore_of !== undefined) {
    const rid = v.uuid(b.restore_of, 'Versão');
    const [r] = await store().select<{ items: Record<string, string>; at: string; channel_id: string }>('page_history', { cols: 'items, at, channel_id', eq: { id: rid } });
    if (!r || r.channel_id !== id) throw new ApiError(404, 'Versão não encontrada.');
    items = r.items;
    note = `restaurado de ${r.at}`;
  }
  const row = await saveItems(id, items, note);
  return json({ ok: true, saved: !!row, entry: row });
});
