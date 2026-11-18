import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { IDENTITY_COLS, MESSAGE_COLS, type Attachment, type ExportChannel, type ExportData, type Identity, type Message } from '@/lib/types';

export const maxDuration = 60;

const MAX_MESSAGES = 20000;
const ATT_COLS = 'id, message_id, storage_path, file_name, mime_type, size_bytes, width, height';


/**
 * Reúne os dados de uma exportação (somente leitura — nada é alterado).
 * Body: { message_ids?: uuid[] } ou { channel_ids?: uuid[] }
 * As mensagens vêm agrupadas por canal, na ordem do modo de cada canal.
 */
export const POST = protectedRoute(async (req) => {
  const b = await readBody(req);
  const s = store();
  const asIds = (x: unknown, field: string) => {
    if (!Array.isArray(x) || x.length > MAX_MESSAGES) throw new ApiError(400, `${field} inválido.`);
    return [...new Set(x.map((i) => v.uuid(i, field)))];
  };

  let messages: Message[] = [];
  let channelIds: string[];
  if (b.message_ids !== undefined) {
    const ids = asIds(b.message_ids, 'Mensagens');
    if (!ids.length) throw new ApiError(400, 'Nenhuma mensagem selecionada.');
    for (let i = 0; i < ids.length; i += 500) {
      messages.push(...await s.select<Message>('messages', { cols: MESSAGE_COLS, in: { id: ids.slice(i, i + 500) } }));
    }
    channelIds = [...new Set(messages.map((m) => m.channel_id))];
  } else {
    channelIds = asIds(b.channel_ids, 'Canais');
    if (!channelIds.length) throw new ApiError(400, 'Nenhum canal selecionado.');
    for (const id of channelIds) {
      messages.push(...await s.select<Message>('messages', { cols: MESSAGE_COLS, eq: { channel_id: id }, limit: MAX_MESSAGES }));
      if (messages.length > MAX_MESSAGES) throw new ApiError(413, `Mais de ${MAX_MESSAGES} mensagens: exporte em partes menores.`);
    }
  }

  // Canais com o caminho (espaço / categoria), na ordem da barra lateral
  const chRows = await s.select<{ id: string; name: string; topic: string | null; icon: string | null; sort_mode: string; space_id: string; category_id: string | null; position: number }>(
    'channels', { cols: 'id, name, topic, icon, sort_mode, space_id, category_id, position', in: { id: channelIds } });
  const spaces = new Map((await s.select<{ id: string; name: string; position: number }>('spaces', { cols: 'id, name, position', in: { id: [...new Set(chRows.map((c) => c.space_id))] } })).map((x) => [x.id, x]));
  const catIds = [...new Set(chRows.map((c) => c.category_id).filter((x): x is string => !!x))];
  const cats = new Map(catIds.length ? (await s.select<{ id: string; name: string; position: number }>('categories', { cols: 'id, name, position', in: { id: catIds } })).map((x) => [x.id, x]) : []);
  chRows.sort((a, z) =>
    (spaces.get(a.space_id)?.position ?? 0) - (spaces.get(z.space_id)?.position ?? 0)
    || (a.category_id ? 1 : 0) - (z.category_id ? 1 : 0)
    || (cats.get(a.category_id ?? '')?.position ?? 0) - (cats.get(z.category_id ?? '')?.position ?? 0)
    || a.position - z.position);
  const channels: ExportChannel[] = chRows.map((c) => ({
    id: c.id, name: c.name, topic: c.topic, icon: c.icon, sort_mode: c.sort_mode,
    space: spaces.get(c.space_id)?.name ?? '', category: c.category_id ? cats.get(c.category_id)?.name ?? null : null,
  }));

  // Ordem de cada canal (manual ou pela data exibida)
  const mode = new Map(chRows.map((c) => [c.id, c.sort_mode]));
  const chOrder = new Map(chRows.map((c, i) => [c.id, i]));
  messages.sort((a, z) => (chOrder.get(a.channel_id) ?? 0) - (chOrder.get(z.channel_id) ?? 0)
    || (mode.get(a.channel_id) === 'chronological'
      ? a.display_at.localeCompare(z.display_at) || a.position - z.position
      : a.position - z.position || a.display_at.localeCompare(z.display_at)));
  messages = messages.filter((m) => chOrder.has(m.channel_id));

  const ids = messages.map((m) => m.id);
  const attachments: Attachment[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    attachments.push(...await s.select<Attachment>('attachments', { cols: ATT_COLS + ', position', in: { message_id: ids.slice(i, i + 500) }, order: [{ col: 'position' }] }));
  }

  // Mensagens citadas que ficaram fora da seleção (para mostrar a citação)
  const inSet = new Set(ids);
  const outside = [...new Set(messages.map((m) => m.reply_to_id).filter((x): x is string => !!x && !inSet.has(x)))];
  const replies = outside.length
    ? (await s.select<{ id: string; identity_id: string | null; content: string }>('messages', { cols: 'id, identity_id, content', in: { id: outside } }))
        .map((r) => ({ ...r, content: r.content.slice(0, 300) }))
    : [];

  const idnIds = [...new Set([...messages, ...replies].map((m) => m.identity_id).filter((x): x is string => !!x))];
  const identities = idnIds.length ? await s.select<Identity>('identities', { cols: IDENTITY_COLS, in: { id: idnIds } }) : [];

  const data: ExportData = { channels, messages, attachments, identities, replies };
  return json(data);
});
