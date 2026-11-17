import { ApiError, json, protectedRoute } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { MESSAGE_COLS, type Message } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Duplica uma mensagem logo abaixo da original (mesmo autor, texto e data exibida).
 * Anexos ainda não são copiados — a duplicação de arquivos chega com a Fase 4.
 */
export const POST = protectedRoute<Ctx>(async (_req, { params }) => {
  const id = v.uuid((await params).id);
  const s = store();
  const [src] = await s.select<Message>('messages', { cols: MESSAGE_COLS, eq: { id } });
  if (!src) throw new ApiError(404, 'Mensagem não encontrada.');

  // Posição entre a original e a próxima (ordem manual em ponto flutuante)
  const pos = Number(src.position);
  const following = await s.select<{ id: string; position: number }>('messages', {
    cols: 'id, position', eq: { channel_id: src.channel_id }, gte: { position: pos },
    order: [{ col: 'position' }], limit: 3,
  });
  const next = following.find((m) => m.id !== id && Number(m.position) > pos);
  const position = next ? (pos + Number(next.position)) / 2 : pos + 1;

  const { discord: _d, ...extra } = src.extra ?? {};
  const [row] = await s.insert<Message>('messages', [{
    channel_id: src.channel_id, identity_id: src.identity_id, content: src.content,
    display_at: src.display_at, position, extra,
  }], { cols: MESSAGE_COLS });
  const hadFiles = (await s.count('attachments', { eq: { message_id: id } })) > 0;
  return json({ message: row, attachments_skipped: hadFiles }, 201);
});
