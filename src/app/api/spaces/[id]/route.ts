import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { SPACE_COLS } from '@/lib/types';
import { archiveChannels, isLogSpace } from '@/lib/server/audit';

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
  const [row] = await store().update('spaces', { eq: { id } }, patch, SPACE_COLS);
  if (!row) throw new ApiError(404, 'Espaço não encontrado.');
  return json(row);
});

/** Exclui o espaço e, em cascata, suas categorias, canais e mensagens. */
export const DELETE = protectedRoute<Ctx>(async (_req, { params }) => {
  const id = v.uuid((await params).id);
  const s = store();
  const [sp] = await s.select<{ name: string }>('spaces', { cols: 'name', eq: { id } });
  if (!sp) throw new ApiError(404, 'Espaço não encontrado.');
  if (await isLogSpace(id)) throw new ApiError(400, 'O espaço LOG guarda o histórico de alterações e não pode ser excluído.');
  // Arquiva todos os canais do espaço no #log antes de excluir
  const chans = await s.select<{ id: string }>('channels', { cols: 'id', eq: { space_id: id }, order: [{ col: 'position' }] });
  await archiveChannels(chans.map((c) => c.id), 'Espaço excluído', [{ label: 'Espaço', value: sp.name }]);
  await s.remove('spaces', { eq: { id } });
  return json({ ok: true });
});
