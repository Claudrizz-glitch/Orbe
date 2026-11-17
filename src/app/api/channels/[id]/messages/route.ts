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
  const sp = req.nextUrl.searchParams;
  const offset = Math.max(0, Number(sp.get('offset')) || 0);
  let limit = Math.min(200, Math.max(1, Number(sp.get('limit')) || 100));
  const s = store();

  const [ch] = await s.select<{ sort_mode: string }>('channels', { cols: 'sort_mode', eq: { id } });
  if (!ch) throw new ApiError(404, 'Canal não encontrado.');
  const chrono = ch.sort_mode === 'chronological';

  const order = chrono
    ? [{ col: 'display_at', asc: false }, { col: 'position', asc: false }]
    : [{ col: 'position', asc: false }, { col: 'display_at', asc: false }];

  // ?around=<id>: carrega do fim do canal até um pouco antes da mensagem pedida
  // (usado para ir a respostas antigas, fixadas e links internos)
  const around = sp.get('around');
  if (around) {
    const [t] = await s.select<Message>('messages', { cols: 'id, channel_id, position, display_at', eq: { id: v.uuid(around, 'Mensagem') } });
    if (!t || t.channel_id !== id) throw new ApiError(404, 'Mensagem não encontrada neste canal.');
    const newer = await s.count('messages', chrono
      ? { eq: { channel_id: id }, gte: { display_at: t.display_at } }
      : { eq: { channel_id: id }, gte: { position: t.position } });
    limit = Math.min(3000, Math.max(limit, newer + 30));
  }

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
 * Body: { content, identity_id?, display_at?, reply_to_id? }
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
  const reply_to_id = b.reply_to_id == null ? null : v.uuid(b.reply_to_id, 'Mensagem respondida');
  if (reply_to_id && !(await s.count('messages', { eq: { id: reply_to_id } }))) throw new ApiError(400, 'A mensagem respondida não existe mais.');

  const [last] = await s.select<{ position: number }>('messages', {
    cols: 'position', eq: { channel_id }, order: [{ col: 'position', asc: false }], limit: 1,
  });
  const [row] = await s.insert<Message>('messages', [{
    channel_id, identity_id, reply_to_id, content, display_at, position: last ? Number(last.position) + 1 : 0,
  }], { cols: MESSAGE_COLS });
  return json(row, 201);
});
