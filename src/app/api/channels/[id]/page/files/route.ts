import { ApiError, json, protectedRoute } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import type { Attachment, Message } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Arquivos de uma página HTML (PDFs, imagens, documentos que a página usa).
 * Ficam como anexos de uma mensagem de sistema do próprio canal — assim entram
 * na exportação, no #log quando apagados e no arquivamento do canal.
 */
async function holders(channelId: string) {
  const msgs = await store().select<Pick<Message, 'id' | 'extra'>>('messages', { cols: 'id, extra', eq: { channel_id: channelId } });
  return msgs.filter((m) => (m.extra as { page_files?: boolean } | null)?.page_files);
}

async function pageChannel(id: string) {
  const [ch] = await store().select<{ id: string; kind: string }>('channels', { cols: 'id, kind', eq: { id } });
  if (!ch) throw new ApiError(404, 'Canal não encontrado.');
  return ch;
}

/** Lista os arquivos da página. */
export const GET = protectedRoute<Ctx>(async (_req, { params }) => {
  const id = v.uuid((await params).id);
  await pageChannel(id);
  const ids = (await holders(id)).map((m) => m.id);
  const files = ids.length
    ? await store().select<Attachment>('attachments', {
        cols: 'id, message_id, storage_path, file_name, mime_type, size_bytes, width, height, position, created_at',
        in: { message_id: ids }, order: [{ col: 'file_name' }],
      })
    : [];
  return json({ message_id: ids[0] ?? null, files });
});

/** Garante a mensagem que guarda os arquivos e devolve o id dela (para enviar anexos). */
export const POST = protectedRoute<Ctx>(async (_req, { params }) => {
  const id = v.uuid((await params).id);
  await pageChannel(id);
  const [h] = await holders(id);
  if (h) return json({ message_id: h.id });
  const [row] = await store().insert<{ id: string }>('messages', [{
    channel_id: id,
    identity_id: null,
    content: 'Arquivos desta página (PDFs e anexos que ela pode abrir).',
    display_at: new Date().toISOString(),
    position: 0,
    extra: { system: true, page_files: true },
  }], { cols: 'id' });
  return json({ message_id: row.id }, 201);
});
