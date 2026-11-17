import { ApiError, json, protectedRoute } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { MESSAGE_COLS, type Message } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

/** Mensagens fixadas do canal, da fixação mais recente para a mais antiga. */
export const GET = protectedRoute<Ctx>(async (_req, { params }) => {
  const id = v.uuid((await params).id);
  const s = store();
  if (!(await s.count('channels', { eq: { id } }))) throw new ApiError(404, 'Canal não encontrado.');
  const rows = await s.select<Message>('messages', {
    cols: MESSAGE_COLS, eq: { channel_id: id }, gte: { pinned_at: '0001-01-01T00:00:00.000Z' },
    order: [{ col: 'pinned_at', asc: false }], limit: 200,
  });
  return json(rows);
});
