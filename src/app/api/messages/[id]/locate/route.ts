import { json, protectedRoute } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';

type Ctx = { params: Promise<{ id: string }> };

/** Em que canal está uma mensagem (para links internos e respostas). Lista vazia se não existir. */
export const GET = protectedRoute<Ctx>(async (_req, { params }) => {
  const id = v.uuid((await params).id);
  return json(await store().select('messages', { cols: 'id, channel_id', eq: { id } }));
});
