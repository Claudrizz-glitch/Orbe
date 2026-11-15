import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { db } from '@/lib/server/db';
import * as v from '@/lib/server/validate';
import { nextPosition } from '@/lib/server/workspace';
import { CHANNEL_COLS } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = protectedRoute<Ctx>(async (req, { params }) => {
  const id = v.uuid((await params).id);
  const b = await readBody(req);

  const { data: current, error: e0 } = await db().from('channels').select('space_id, category_id').eq('id', id).maybeSingle();
  if (e0) throw e0;
  if (!current) throw new ApiError(404, 'Canal não encontrado.');

  let category_id: string | null | undefined;
  let position: number | undefined;
  if (b.category_id !== undefined) {
    category_id = b.category_id === null ? null : v.uuid(b.category_id, 'Categoria');
    if (category_id !== current.category_id) {
      if (category_id) {
        const { data } = await db().from('categories').select('space_id').eq('id', category_id).maybeSingle();
        if (!data || data.space_id !== current.space_id) throw new ApiError(400, 'A categoria não pertence a este espaço.');
      }
      position = await nextPosition('channels', { space_id: current.space_id, category_id });
    } else {
      category_id = undefined;
    }
  }

  if (b.sort_mode !== undefined && b.sort_mode !== 'manual' && b.sort_mode !== 'chronological') {
    throw new ApiError(400, 'Modo de ordenação inválido.');
  }

  const patch = v.defined({
    name: b.name === undefined ? undefined : v.name(b.name),
    icon: v.optIcon(b.icon),
    color: v.optColor(b.color),
    topic: v.optText(b.topic, 1000, 'Descrição'),
    sort_mode: b.sort_mode as string | undefined,
    category_id,
    position,
  });
  if (!Object.keys(patch).length) {
    const { data } = await db().from('channels').select(CHANNEL_COLS).eq('id', id).single();
    return json(data);
  }
  const { data, error } = await db().from('channels').update(patch).eq('id', id).select(CHANNEL_COLS).single();
  if (error) throw error;
  return json(data);
});

/** Exclui o canal e, em cascata, suas mensagens. */
export const DELETE = protectedRoute<Ctx>(async (_req, { params }) => {
  const id = v.uuid((await params).id);
  const { data, error } = await db().from('channels').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new ApiError(404, 'Canal não encontrado.');
  return json({ ok: true });
});
