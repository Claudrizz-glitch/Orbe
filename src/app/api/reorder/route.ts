import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { db } from '@/lib/server/db';
import * as v from '@/lib/server/validate';

/**
 * Reordena uma lista inteira de irmãos de forma atômica.
 * Body:
 *   { table: 'spaces', ids: [...] }
 *   { table: 'categories', ids: [...] }                       (mesmo espaço)
 *   { table: 'channels', ids: [...], category_id?: uuid|null,  (mesmo espaço e categoria)
 *     move_id?: uuid }   → move_id muda de categoria para category_id
 */
export const POST = protectedRoute(async (req) => {
  const b = await readBody(req);
  const table = b.table;
  if (table !== 'spaces' && table !== 'categories' && table !== 'channels') {
    throw new ApiError(400, 'Tabela inválida.');
  }
  if (!Array.isArray(b.ids) || b.ids.length === 0 || b.ids.length > 1000) throw new ApiError(400, 'Lista de IDs inválida.');
  const ids = b.ids.map((x) => v.uuid(x));
  if (new Set(ids).size !== ids.length) throw new ApiError(400, 'IDs duplicados.');

  const cols = table === 'spaces' ? 'id' : table === 'categories' ? 'id, space_id' : 'id, space_id, category_id';
  const { data: rows, error } = await db().from(table).select(cols).in('id', ids);
  if (error) throw error;
  if (!rows || rows.length !== ids.length) throw new ApiError(404, 'Algum item não foi encontrado.');

  if (table === 'channels') {
    const list = rows as unknown as { id: string; space_id: string; category_id: string | null }[];
    const targetCat = b.category_id === undefined ? list[0].category_id : b.category_id === null ? null : v.uuid(b.category_id, 'Categoria');
    const moveId = b.move_id === undefined ? null : v.uuid(b.move_id, 'Canal');
    const spaceId = list[0].space_id;
    if (list.some((r) => r.space_id !== spaceId)) throw new ApiError(400, 'Canais de espaços diferentes.');
    if (list.some((r) => r.id !== moveId && r.category_id !== targetCat)) throw new ApiError(400, 'Canais de categorias diferentes.');
    if (moveId && !ids.includes(moveId)) throw new ApiError(400, 'Canal movido ausente da lista.');

    if (moveId) {
      const { error: e } = await db().rpc('orbe_move_channel', { p_channel_id: moveId, p_category_id: targetCat, p_ordered_ids: ids });
      if (e) throw e;
      return json({ ok: true });
    }
  } else if (table === 'categories') {
    const list = rows as unknown as { space_id: string }[];
    if (list.some((r) => r.space_id !== list[0].space_id)) throw new ApiError(400, 'Categorias de espaços diferentes.');
  }

  const { error: e2 } = await db().rpc('orbe_reorder', { p_table: table, p_ids: ids });
  if (e2) throw e2;
  return json({ ok: true });
});
