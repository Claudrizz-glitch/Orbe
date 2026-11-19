import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { nextPosition } from '@/lib/server/workspace';
import { CATEGORY_COLS } from '@/lib/types';
import { validParent } from '@/lib/server/categoryTree';

export const POST = protectedRoute(async (req) => {
  const b = await readBody(req);
  const space_id = v.uuid(b.space_id, 'Espaço');
  if (!(await store().count('spaces', { eq: { id: space_id } }))) throw new ApiError(404, 'Espaço não encontrado.');
  const [row] = await store().insert('categories', [{
    space_id,
    name: v.name(b.name),
    icon: v.optIcon(b.icon) ?? null,
    color: v.optColor(b.color) ?? null,
    parent_id: b.parent_id === undefined ? null : await validParent(b.parent_id, space_id),
    position: await nextPosition('categories', { space_id }),
  }], { cols: CATEGORY_COLS });
  return json(row, 201);
});
