import { ApiError, json, protectedRoute } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import type { Attachment } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

/** Todos os anexos de um canal (metadados), na ordem das mensagens — usado para baixar tudo em .zip. */
export const GET = protectedRoute<Ctx>(async (_req, { params }) => {
  const id = v.uuid((await params).id);
  const s = store();
  if (!(await s.count('channels', { eq: { id } }))) throw new ApiError(404, 'Canal não encontrado.');
  const msgs = await s.select<{ id: string; display_at: string }>('messages', { cols: 'id, display_at', eq: { channel_id: id }, order: [{ col: 'position' }] });
  if (!msgs.length) return json([]);
  const order = new Map(msgs.map((m, i) => [m.id, i]));
  const out: (Attachment & { display_at: string })[] = [];
  const when = new Map(msgs.map((m) => [m.id, m.display_at]));
  for (let i = 0; i < msgs.length; i += 500) {
    const ids = msgs.slice(i, i + 500).map((m) => m.id);
    const rows = await s.select<Attachment>('attachments', {
      cols: 'id, message_id, storage_path, file_name, mime_type, size_bytes, width, height', in: { message_id: ids },
    });
    out.push(...rows.map((r) => ({ ...r, display_at: when.get(r.message_id) ?? '' })));
  }
  out.sort((a, b) => (order.get(a.message_id) ?? 0) - (order.get(b.message_id) ?? 0));
  return json(out);
});
