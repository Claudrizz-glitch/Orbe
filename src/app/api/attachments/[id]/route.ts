import { ApiError, json, protectedRoute } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { COLORS, audit, block, describeChannel, identityName, isLogChannel, when } from '@/lib/server/audit';

type Ctx = { params: Promise<{ id: string }> };

/** Remove um anexo (registro e arquivo). */
export const DELETE = protectedRoute<Ctx>(async (_req, { params }) => {
  const id = v.uuid((await params).id);
  const s = store();
  const [a] = await s.select<{ storage_path: string; file_name: string; size_bytes: number; message_id: string }>('attachments', { cols: 'storage_path, file_name, size_bytes, message_id', eq: { id } });
  if (!a) throw new ApiError(404, 'Anexo não encontrado.');
  const [m] = await s.select<{ channel_id: string; identity_id: string | null; content: string; display_at: string }>('messages', { cols: 'channel_id, identity_id, content, display_at', eq: { id: a.message_id } });
  if (m && !(await isLogChannel(m.channel_id))) {
    // O arquivo é transferido para o registro em vez de apagado
    const logged = await audit({
      title: 'Anexo removido de uma mensagem', color: COLORS.delete, author: await identityName(m.identity_id),
      fields: [
        { label: 'Canal de texto', value: await describeChannel(m.channel_id) },
        { label: 'Arquivo', value: `${a.file_name} (${Math.max(1, Math.round(a.size_bytes / 1024))} KB) — preservado neste registro` },
        { label: 'Mensagem', value: `
${block(m.content.slice(0, 1500))}` },
      ],
      footer: `ID da mensagem: ${a.message_id} · Data exibida: ${when(m.display_at)}`,
      attachmentIds: [id],
      ref: { event: 'attachment.remove', attachment_id: id, message_id: a.message_id },
    });
    if (logged) return json({ ok: true, logged: true });
  }
  await s.remove('attachments', { eq: { id } });
  await s.removeFile(a.storage_path).catch(() => {});
  return json({ ok: true });
});
