import { json, protectedRoute, readBody } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { nextPosition } from '@/lib/server/workspace';
import { SPACE_COLS } from '@/lib/types';

export const POST = protectedRoute(async (req) => {
  const b = await readBody(req);
  const [row] = await store().insert('spaces', [{
    name: v.name(b.name),
    icon: v.optIcon(b.icon) ?? null,
    color: v.optColor(b.color) ?? null,
    position: await nextPosition('spaces'),
  }], { cols: SPACE_COLS });
  return json(row, 201);
});
