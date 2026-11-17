import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { IDENTITY_COLS, type Identity } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = protectedRoute<Ctx>(async (req, { params }) => {
  const id = v.uuid((await params).id);
  const b = await readBody(req);
  const patch = v.defined({
    name: b.name === undefined ? undefined : v.name(b.name),
    description: v.optText(b.description, 2000, 'Descrição'),
    color: v.optColor(b.color),
  });
  if (!Object.keys(patch).length) throw new ApiError(400, 'Nada para atualizar.');
  const [row] = await store().update<Identity>('identities', { eq: { id } }, patch, IDENTITY_COLS);
  if (!row) throw new ApiError(404, 'Identidade não encontrada.');
  return json(row);
});

/**
 * Exclui uma identidade.
 *   ?reassign_to=<id> → as mensagens passam para outra identidade (mesclar)
 *   sem parâmetro     → as mensagens são mantidas, sem autor
 * O perfil principal não pode ser excluído.
 */
export const DELETE = protectedRoute<Ctx>(async (req, { params }) => {
  const id = v.uuid((await params).id);
  const s = store();
  const [idn] = await s.select<Identity>('identities', { cols: IDENTITY_COLS, eq: { id } });
  if (!idn) throw new ApiError(404, 'Identidade não encontrada.');
  if (idn.is_owner) throw new ApiError(400, 'O perfil principal não pode ser excluído.');

  const target = req.nextUrl.searchParams.get('reassign_to');
  if (target) {
    const to = v.uuid(target, 'Identidade de destino');
    if (to === id) throw new ApiError(400, 'Escolha outra identidade.');
    if (!(await s.count('identities', { eq: { id: to } }))) throw new ApiError(404, 'Identidade de destino não encontrada.');
    await s.update('messages', { eq: { identity_id: id } }, { identity_id: to }, 'id');
    // Reimportações do Discord passam a usar a identidade mesclada
    await s.update('import_map', { eq: { kind: 'identity', local_id: id } }, { local_id: to }, 'external_id');
  }
  await s.remove('identities', { eq: { id } });
  if (idn.avatar_path) await s.removeFile(idn.avatar_path).catch(() => {});
  return json({ ok: true });
});
