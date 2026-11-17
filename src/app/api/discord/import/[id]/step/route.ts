import { ApiError, json, protectedRoute } from '@/lib/server/api';
import { runStep, toPublic } from '@/lib/server/discord/importer';
import * as v from '@/lib/server/validate';

// Cada etapa trabalha ~20 s e salva o progresso (cabe no limite das funções da Vercel)
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export const POST = protectedRoute<Ctx>(async (_req, { params }) => {
  const j = await runStep(v.uuid((await params).id), 20000);
  if (!j) throw new ApiError(404, 'Importação não encontrada.');
  return json(toPublic(j));
});
