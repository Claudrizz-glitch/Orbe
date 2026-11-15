import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { db } from '@/lib/server/db';
import * as v from '@/lib/server/validate';
import { nextPosition } from '@/lib/server/workspace';
import { CATEGORY_COLS } from '@/lib/types';

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
  if (!Object.keys(patch).length) throw new ApiError(400, 'Nada para atualizar.');
  const { data, error } = await db().from('categories').update(patch).eq('id', id).select(CATEGORY_COLS).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, 'Categoria não encontrada.');
  return json(data);
});

/**
 * ?channels=keep   → os canais são preservados e ficam sem categoria (padrão)
 * ?channels=delete → os canais (e suas mensagens) são excluídos junto
 */
export const DELETE = protectedRoute<Ctx>(async (req, { params }) => {
  const id = v.uuid((await params).id);
  const mode = req.nextUrl.searchParams.get('channels') ?? 'keep';
  if (mode !== 'keep' && mode !== 'delete') throw new ApiError(400, 'Modo de exclusão inválido.');

  const { data: cat, error: e1 } = await db().from('categories').select('id, space_id').eq('id', id).maybeSingle();
  if (e1) throw e1;
  if (!cat) throw new ApiError(404, 'Categoria não encontrada.');

  if (mode === 'delete') {
    const { error } = await db().from('channels').delete().eq('category_id', id);
    if (error) throw error;
  } else {
    // Canais preservados vão para o fim da lista de canais sem categoria
    const { data: kids, error } = await db().from('channels').select('id').eq('category_id', id).order('position');
    if (error) throw error;
    let pos = await nextPosition('channels', { space_id: cat.space_id, category_id: null });
    for (const ch of kids ?? []) {
      const { error: e } = await db().from('channels').update({ category_id: null, position: pos++ }).eq('id', ch.id);
      if (e) throw e;
    }
  }
  const { error } = await db().from('categories').delete().eq('id', id);
  if (error) throw error;
  return json({ ok: true });
});
