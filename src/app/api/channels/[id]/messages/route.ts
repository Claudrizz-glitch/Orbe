import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { MESSAGE_COLS, type Attachment, type Message, type MessagePage, type ReplyPreview } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Página de mensagens de um canal, das mais recentes para as mais antigas
 * (?offset=N para carregar as anteriores). A ordem respeita o modo do canal:
 * manual (position) ou cronológico (display_at).
 */
export const GET = protectedRoute<Ctx>(async (req, { params }) => {
  const id = v.uuid((await params).id);
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get('offset')) || 0);
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 100));
  const s = store();

  const [ch] = await s.select<{ sort_mode: string }>('channels', { cols: 'sort_mode', eq: { id } });
  if (!ch) throw new ApiError(404, 'Canal não encontrado.');

  const order = ch.sort_mode === 'chronological'
    ? [{ col: 'display_at', asc: false }, { col: 'position', asc: false }]
    : [{ col: 'position', asc: false }, { col: 'display_at', asc: false }];

  const rows = await s.select<Message>('messages', { cols: MESSAGE_COLS, eq: { channel_id: id }, order, offset, limit: limit + 1 });
  const has_more = rows.length > limit;
  const messages = rows.slice(0, limit).reverse();
  const ids = messages.map((m) => m.id);

  const attachments = ids.length
    ? await s.select<Attachment>('attachments', {
        cols: 'id, message_id, storage_path, file_name, mime_type, size_bytes, width, height',
        in: { message_id: ids }, order: [{ col: 'position' }],
      })
    : [];

  const replyIds = [...new Set(messages.map((m) => m.reply_to_id).filter((x): x is string => !!x))];
  const replies = replyIds.length
    ? (await s.select<ReplyPreview>('messages', { cols: 'id, identity_id, content', in: { id: replyIds } }))
        .map((r) => ({ ...r, content: r.content.slice(0, 200) }))
    : [];

  const page: MessagePage = { messages, attachments, replies, has_more };
  return json(page);
});

/**
 * Cria uma mensagem no fim do canal.
 * Body: { content, identity_id?, display_at? }
 */
export const POST = protectedRoute<Ctx>(async (req, { params }) => {
  const channel_id = v.uuid((await params).id);
  const b = await readBody(req);
  const s = store();
  if (!(await s.count('channels', { eq: { id: channel_id } }))) throw new ApiError(404, 'Canal não encontrado.');

  const content = v.content(b.content);
  if (!content.trim()) throw new ApiError(400, 'A mensagem está vazia.');
  const identity_id = b.identity_id == null ? null : v.uuid(b.identity_id, 'Identidade');
  if (identity_id && !(await s.count('identities', { eq: { id: identity_id } }))) throw new ApiError(400, 'Identidade não encontrada.');
  const display_at = b.display_at === undefined ? new Date().toISOString() : v.isoDate(b.display_at, 'Data de exibição');

  const [last] = await s.select<{ position: number }>('messages', {
    cols: 'position', eq: { channel_id }, order: [{ col: 'position', asc: false }], limit: 1,
  });
  const [row] = await s.insert<Message>('messages', [{
    channel_id, identity_id, content, display_at, position: last ? Number(last.position) + 1 : 0,
  }], { cols: MESSAGE_COLS });
  return json(row, 201);
});
