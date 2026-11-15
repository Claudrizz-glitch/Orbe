import { json, protectedRoute, readBody } from '@/lib/server/api';
import { db } from '@/lib/server/db';
import * as v from '@/lib/server/validate';
import { nextPosition } from '@/lib/server/workspace';
import { CATEGORY_COLS } from '@/lib/types';

export const POST = protectedRoute(async (req) => {
  const b = await readBody(req);
  const space_id = v.uuid(b.space_id, 'Espaço');
  const row = {
    space_id,
    name: v.name(b.name),
    icon: v.optIcon(b.icon) ?? null,
    color: v.optColor(b.color) ?? null,
    position: await nextPosition('categories', { space_id }),
  };
  const { data, error } = await db().from('categories').insert(row).select(CATEGORY_COLS).single();
  if (error) throw error;
  return json(data, 201);
});
