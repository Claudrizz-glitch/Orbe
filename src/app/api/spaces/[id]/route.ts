import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { db } from '@/lib/server/db';
import * as v from '@/lib/server/validate';
import { SPACE_COLS } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = protectedRoute<Ctx>(async (req, { params }) => {
  const id = v.uuid((await params).id);
  const b = await readBody(req);
  const patch = v.defined({
    name: b.name === undefined ? undefined : v.name(b.name),
    icon: v.optIcon(b.icon),
    color: v.optColor(b.color),
    appearance: v.optObject(b.appearance, 'Aparência'),
  });
  if (!Object.keys(patch).length) throw new ApiError(400, 'Nada para atualizar.');
  const { data, error } = await db().from('spaces').update(patch).eq('id', id).select(SPACE_COLS).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, 'Espaço não encontrado.');
  return json(data);
});

/** Exclui o espaço e, em cascata, suas categorias, canais e mensagens. */
export const DELETE = protectedRoute<Ctx>(async (_req, { params }) => {
  const id = v.uuid((await params).id);
  const { data, error } = await db().from('spaces').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new ApiError(404, 'Espaço não encontrado.');
  return json({ ok: true });
});
