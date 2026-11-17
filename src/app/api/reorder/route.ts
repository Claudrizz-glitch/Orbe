import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { store } from '@/lib/server/store';
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
  if (table !== 'spaces' && table !== 'categories' && table !== 'channels') throw new ApiError(400, 'Tabela inválida.');
  if (!Array.isArray(b.ids) || b.ids.length === 0 || b.ids.length > 1000) throw new ApiError(400, 'Lista de IDs inválida.');
  const ids = b.ids.map((x) => v.uuid(x));
  if (new Set(ids).size !== ids.length) throw new ApiError(400, 'IDs duplicados.');

  const s = store();
  const rows = await s.select<{ id: string; space_id?: string; category_id?: string | null }>(table, {
    cols: table === 'spaces' ? 'id' : table === 'categories' ? 'id, space_id' : 'id, space_id, category_id',
    in: { id: ids },
  });
  if (rows.length !== ids.length) throw new ApiError(404, 'Algum item não foi encontrado.');

  if (table === 'channels') {
    const targetCat = b.category_id === undefined ? rows[0].category_id ?? null : b.category_id === null ? null : v.uuid(b.category_id, 'Categoria');
    const moveId = b.move_id === undefined ? null : v.uuid(b.move_id, 'Canal');
    if (rows.some((r) => r.space_id !== rows[0].space_id)) throw new ApiError(400, 'Canais de espaços diferentes.');
    if (rows.some((r) => r.id !== moveId && (r.category_id ?? null) !== targetCat)) throw new ApiError(400, 'Canais de categorias diferentes.');
    if (moveId && !ids.includes(moveId)) throw new ApiError(400, 'Canal movido ausente da lista.');
    if (moveId) {
      await s.moveChannel(moveId, targetCat, ids);
      return json({ ok: true });
    }
  } else if (table === 'categories' && rows.some((r) => r.space_id !== rows[0].space_id)) {
    throw new ApiError(400, 'Categorias de espaços diferentes.');
  }

  await s.reorder(table, ids);
  return json({ ok: true });
});
