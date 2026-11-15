import { json, protectedRoute, readBody } from '@/lib/server/api';
import { db } from '@/lib/server/db';
import * as v from '@/lib/server/validate';
import { nextPosition } from '@/lib/server/workspace';
import { SPACE_COLS } from '@/lib/types';

export const POST = protectedRoute(async (req) => {
  const b = await readBody(req);
  const row = {
    name: v.name(b.name),
    icon: v.optIcon(b.icon) ?? null,
    color: v.optColor(b.color) ?? null,
    position: await nextPosition('spaces'),
  };
  const { data, error } = await db().from('spaces').insert(row).select(SPACE_COLS).single();
  if (error) throw error;
  return json(data, 201);
});
