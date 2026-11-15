import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { db } from '@/lib/server/db';
import * as v from '@/lib/server/validate';
import { nextPosition } from '@/lib/server/workspace';
import { CHANNEL_COLS } from '@/lib/types';

export const POST = protectedRoute(async (req) => {
  const b = await readBody(req);
  const space_id = v.uuid(b.space_id, 'Espaço');
  const category_id = b.category_id == null ? null : v.uuid(b.category_id, 'Categoria');
  if (category_id) {
    const { data } = await db().from('categories').select('space_id').eq('id', category_id).maybeSingle();
    if (!data || data.space_id !== space_id) throw new ApiError(400, 'A categoria não pertence a este espaço.');
  }
  const row = {
    space_id,
    category_id,
    name: v.name(b.name),
    icon: v.optIcon(b.icon) ?? null,
    color: v.optColor(b.color) ?? null,
    topic: v.optText(b.topic, 1000, 'Descrição') ?? null,
    position: await nextPosition('channels', { space_id, category_id }),
  };
  const { data, error } = await db().from('channels').insert(row).select(CHANNEL_COLS).single();
  if (error) throw error;
  return json(data, 201);
});
