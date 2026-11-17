import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { MESSAGE_COLS, type Message } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Edita uma mensagem — sem limite de tempo.
 * Body (todos opcionais): { content, identity_id, display_at }
 *  - content altera edited_at (última edição pelo usuário)
 *  - display_at altera apenas a data EXIBIDA; created_at nunca muda
 */
export const PATCH = protectedRoute<Ctx>(async (req, { params }) => {
  const id = v.uuid((await params).id);
  const b = await readBody(req);
  const s = store();

  const [cur] = await s.select<Message>('messages', { cols: 'id, content', eq: { id } });
  if (!cur) throw new ApiError(404, 'Mensagem não encontrada.');

  const patch: Record<string, unknown> = {};
  if (b.content !== undefined) {
    const content = v.content(b.content);
    if (!content.trim()) throw new ApiError(400, 'A mensagem não pode ficar vazia. Use “Excluir” para removê-la.');
    if (content !== cur.content) { patch.content = content; patch.edited_at = new Date().toISOString(); }
  }
  if (b.identity_id !== undefined) {
    const identity_id = b.identity_id === null ? null : v.uuid(b.identity_id, 'Identidade');
    if (identity_id && !(await s.count('identities', { eq: { id: identity_id } }))) throw new ApiError(400, 'Identidade não encontrada.');
    patch.identity_id = identity_id;
  }
  if (b.display_at !== undefined) patch.display_at = v.isoDate(b.display_at, 'Data de exibição');

  if (!Object.keys(patch).length) {
    const [row] = await s.select<Message>('messages', { cols: MESSAGE_COLS, eq: { id } });
    return json(row);
  }
  const [row] = await s.update<Message>('messages', { eq: { id } }, patch, MESSAGE_COLS);
  return json(row);
});

/** Exclui a mensagem e os arquivos dos seus anexos. */
export const DELETE = protectedRoute<Ctx>(async (_req, { params }) => {
  const id = v.uuid((await params).id);
  const s = store();
  const files = await s.select<{ storage_path: string }>('attachments', { cols: 'storage_path', eq: { message_id: id } });
  if (!(await s.remove('messages', { eq: { id } }))) throw new ApiError(404, 'Mensagem não encontrada.');
  for (const f of files) await s.removeFile(f.storage_path).catch(() => {});
  return json({ ok: true });
});
