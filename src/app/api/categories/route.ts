import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { nextPosition } from '@/lib/server/workspace';
import { CATEGORY_COLS } from '@/lib/types';

export const POST = protectedRoute(async (req) => {
  const b = await readBody(req);
  const space_id = v.uuid(b.space_id, 'Espaço');
  if (!(await store().count('spaces', { eq: { id: space_id } }))) throw new ApiError(404, 'Espaço não encontrado.');
  const [row] = await store().insert('categories', [{
    space_id,
    name: v.name(b.name),
    icon: v.optIcon(b.icon) ?? null,
    color: v.optColor(b.color) ?? null,
    position: await nextPosition('categories', { space_id }),
  }], { cols: CATEGORY_COLS });
  return json(row, 201);
});
