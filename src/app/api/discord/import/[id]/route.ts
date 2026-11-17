import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { getJob, setJobStatus, toPublic } from '@/lib/server/discord/importer';
import * as v from '@/lib/server/validate';

type Ctx = { params: Promise<{ id: string }> };

export const GET = protectedRoute<Ctx>(async (_req, { params }) => {
  const j = await getJob(v.uuid((await params).id));
  if (!j) throw new ApiError(404, 'Importação não encontrada.');
  return json(toPublic(j));
});

/** { action: 'resume' | 'cancel' } */
export const PATCH = protectedRoute<Ctx>(async (req, { params }) => {
  const id = v.uuid((await params).id);
  const { action } = await readBody(req);
  if (action !== 'resume' && action !== 'cancel') throw new ApiError(400, 'Ação inválida.');
  const j = await setJobStatus(id, action);
  if (!j) throw new ApiError(404, 'Importação não encontrada.');
  return json(toPublic(j));
});
