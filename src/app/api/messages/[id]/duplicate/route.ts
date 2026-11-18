import { ApiError, json, protectedRoute } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { randomUUID } from 'node:crypto';
import { MESSAGE_COLS, type Attachment, type Message } from '@/lib/types';

const ATT_COLS = 'id, message_id, storage_path, file_name, mime_type, size_bytes, width, height';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Duplica uma mensagem logo abaixo da original (mesmo autor, texto e data exibida).
 * Os anexos são copiados (arquivo e registro).
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
  // Copia os anexos (arquivo e registro) para a nova mensagem
  const atts = await s.select<Attachment>('attachments', { cols: ATT_COLS + ', position', eq: { message_id: id }, order: [{ col: 'position' }] });
  let failed = 0;
  const copies: Attachment[] = [];
  for (const a of atts) {
    const to = `attachments/${row.id}/${randomUUID()}-${a.storage_path.split('/').pop()!.replace(/^[0-9a-f-]{36}-/, '')}`;
    try {
      await s.copyFile(a.storage_path, to);
      const [c] = await s.insert<Attachment>('attachments', [{
        message_id: row.id, storage_path: to, file_name: a.file_name, mime_type: a.mime_type,
        size_bytes: a.size_bytes, width: a.width, height: a.height, position: (a as Attachment & { position: number }).position,
      }], { cols: ATT_COLS });
      copies.push(c);
    } catch { failed++; }
  }
  return json({ message: row, attachments: copies, attachments_skipped: failed > 0 }, 201);
});
