import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { nextPosition } from '@/lib/server/workspace';
import { CATEGORY_COLS } from '@/lib/types';
import { archiveChannels, isLogChannel } from '@/lib/server/audit';
import { validParent } from '@/lib/server/categoryTree';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = protectedRoute<Ctx>(async (req, { params }) => {
  const id = v.uuid((await params).id);
  const b = await readBody(req);
  const patch = v.defined({
    name: b.name === undefined ? undefined : v.name(b.name),
    icon: v.optIcon(b.icon),
    color: v.optColor(b.color),
    collapsed: v.optBool(b.collapsed, 'Recolhida'),
  });
  if (b.parent_id !== undefined) {
    const [cur] = await store().select<{ space_id: string }>('categories', { cols: 'space_id', eq: { id } });
    if (!cur) throw new ApiError(404, 'Categoria não encontrada.');
    (patch as Record<string, unknown>).parent_id = await validParent(b.parent_id, cur.space_id, id);
    // vai para o fim da nova lista de irmãs
    (patch as Record<string, unknown>).position = await nextPosition('categories', { space_id: cur.space_id });
  }
  if (!Object.keys(patch).length) throw new ApiError(400, 'Nada para atualizar.');
  const [row] = await store().update('categories', { eq: { id } }, patch, CATEGORY_COLS);
  if (!row) throw new ApiError(404, 'Categoria não encontrada.');
  return json(row);
});

/**
 * Subcategorias sobem um nível.
 * ?channels=keep   → os canais vão para a categoria-mãe, ou ficam sem categoria (padrão)
 * ?channels=delete → os canais (e suas mensagens) são excluídos junto
 */
export const DELETE = protectedRoute<Ctx>(async (req, { params }) => {
  const id = v.uuid((await params).id);
  const mode = req.nextUrl.searchParams.get('channels') ?? 'keep';
  if (mode !== 'keep' && mode !== 'delete') throw new ApiError(400, 'Modo de exclusão inválido.');
  const s = store();

  const [cat] = await s.select<{ id: string; space_id: string; parent_id: string | null }>('categories', { cols: 'id, space_id, parent_id', eq: { id } });
  if (!cat) throw new ApiError(404, 'Categoria não encontrada.');

  // Subcategorias não são apagadas: sobem um nível (para a categoria-mãe)
  await s.update('categories', { eq: { parent_id: id } }, { parent_id: cat.parent_id ?? null }, 'id');

  if (mode === 'delete') {
    const kids = await s.select<{ id: string }>('channels', { cols: 'id', eq: { category_id: id }, order: [{ col: 'position' }] });
    for (const k of kids) if (await isLogChannel(k.id)) throw new ApiError(400, 'Esta categoria contém o #log, que não pode ser excluído.');
    const [c] = await s.select<{ name: string }>('categories', { cols: 'name', eq: { id } });
    await archiveChannels(kids.map((k) => k.id), 'Categoria excluída (com os canais)', [{ label: 'Categoria', value: c?.name ?? '' }]);
    await s.remove('channels', { eq: { category_id: id } });
  } else {
    // Canais preservados vão para o fim da categoria-mãe (ou ficam sem categoria)
    const to = cat.parent_id ?? null;
    const kids = await s.select<{ id: string }>('channels', { cols: 'id', eq: { category_id: id }, order: [{ col: 'position' }] });
    let pos = await nextPosition('channels', { space_id: cat.space_id, category_id: to });
    for (const ch of kids) await s.update('channels', { eq: { id: ch.id } }, { category_id: to, position: pos++ }, 'id');
  }
  await s.remove('categories', { eq: { id } });
  return json({ ok: true });
});
