import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { COLORS, audit, auditMessageDeleted, block, describeChannel, identityName, isLogChannel, when } from '@/lib/server/audit';
import { MESSAGE_COLS, type Message } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Edita uma mensagem — sem limite de tempo.
 * Body (todos opcionais): { content, identity_id, display_at, pinned }
 *  - content altera edited_at (última edição pelo usuário)
 *  - display_at altera apenas a data EXIBIDA; created_at nunca muda
 * Toda alteração de texto, autor ou data é registrada no #log.
 */
export const PATCH = protectedRoute<Ctx>(async (req, { params }) => {
  const id = v.uuid((await params).id);
  const b = await readBody(req);
  const s = store();

  const [cur] = await s.select<Message>('messages', { cols: MESSAGE_COLS, eq: { id } });
  if (!cur) throw new ApiError(404, 'Mensagem não encontrada.');

  const patch: Record<string, unknown> = {};
  if (b.content !== undefined) {
    const content = v.content(b.content);
    if (!content.trim() && !(await s.count('attachments', { eq: { message_id: id } }))) {
      throw new ApiError(400, 'A mensagem não pode ficar vazia. Use “Excluir” para removê-la.');
    }
    if (content !== cur.content) { patch.content = content; patch.edited_at = new Date().toISOString(); }
  }
  if (b.identity_id !== undefined) {
    const identity_id = b.identity_id === null ? null : v.uuid(b.identity_id, 'Identidade');
    if (identity_id && !(await s.count('identities', { eq: { id: identity_id } }))) throw new ApiError(400, 'Identidade não encontrada.');
    if (identity_id !== cur.identity_id) patch.identity_id = identity_id;
  }
  if (b.display_at !== undefined) {
    const d = v.isoDate(b.display_at, 'Data de exibição');
    if (new Date(d).getTime() !== new Date(cur.display_at).getTime()) patch.display_at = d;
  }
  if (b.pinned !== undefined) {
    if (typeof b.pinned !== 'boolean') throw new ApiError(400, 'Valor de “fixada” inválido.');
    patch.pinned_at = b.pinned ? new Date().toISOString() : null;
  }

  if (!Object.keys(patch).length) return json(cur);
  const [row] = await s.update<Message>('messages', { eq: { id } }, patch, MESSAGE_COLS);

  // ── Registro ──
  if (!(await isLogChannel(cur.channel_id))) {
    const where = await describeChannel(cur.channel_id);
    const author = await identityName(cur.identity_id);
    const footer = `ID da mensagem: ${id} · Data exibida: ${when(cur.display_at)}`;
    if (patch.content !== undefined) {
      await audit({
        title: 'Mensagem de texto editada', color: COLORS.edit, author,
        fields: [
          { label: 'Autor', value: author },
          { label: 'Canal de texto', value: where },
          { label: 'Antiga mensagem', value: `\n${block(cur.content)}` },
          { label: 'Nova mensagem', value: `\n${block(String(patch.content))}` },
        ],
        footer, ref: { event: 'message.edit', message_id: id, channel_id: cur.channel_id, old: cur.content, new: patch.content },
      });
    }
    if (patch.identity_id !== undefined) {
      await audit({
        title: 'Autor da mensagem alterado', color: COLORS.info, author,
        fields: [
          { label: 'Canal de texto', value: where },
          { label: 'Autor anterior', value: author },
          { label: 'Novo autor', value: await identityName(patch.identity_id as string | null) },
          { label: 'Mensagem', value: `\n${block(cur.content.slice(0, 600))}` },
        ],
        footer, ref: { event: 'message.author', message_id: id, old: cur.identity_id, new: patch.identity_id },
      });
    }
    if (patch.display_at !== undefined) {
      await audit({
        title: 'Data e hora da mensagem alteradas', color: COLORS.info, author,
        fields: [
          { label: 'Canal de texto', value: where },
          { label: 'Data anterior', value: when(cur.display_at) },
          { label: 'Nova data', value: when(String(patch.display_at)) },
          { label: 'Mensagem', value: `\n${block(cur.content.slice(0, 600))}` },
        ],
        footer: `ID da mensagem: ${id}`, ref: { event: 'message.date', message_id: id, old: cur.display_at, new: patch.display_at },
      });
    }
  }
  return json(row);
});

/**
 * Exclui a mensagem. O texto completo vai para o #log e os anexos passam a
 * pertencer ao registro (os arquivos NÃO são apagados — podem ser recuperados).
 * Excluir algo do próprio #log apaga de verdade.
 */
export const DELETE = protectedRoute<Ctx>(async (_req, { params }) => {
  const id = v.uuid((await params).id);
  const s = store();
  const [m] = await s.select<Message>('messages', { cols: MESSAGE_COLS, eq: { id } });
  if (!m) throw new ApiError(404, 'Mensagem não encontrada.');
  const atts = await s.select<{ id: string; storage_path: string; file_name: string }>('attachments', { cols: 'id, storage_path, file_name', eq: { message_id: id } });

  if (await isLogChannel(m.channel_id)) {
    await s.remove('messages', { eq: { id } });
    for (const f of atts) await s.removeFile(f.storage_path).catch(() => {});
    return json({ ok: true });
  }

  const logged = await auditMessageDeleted(m, atts.map((a) => a.id), atts.map((a) => a.file_name));
  await s.remove('messages', { eq: { id } });
  // Se o registro falhou, os anexos ainda estavam ligados à mensagem: apaga os arquivos órfãos
  if (!logged) for (const f of atts) await s.removeFile(f.storage_path).catch(() => {});
  return json({ ok: true, logged: !!logged });
});
