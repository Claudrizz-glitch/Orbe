import { ApiError, json, protectedRoute } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';

type Ctx = { params: Promise<{ id: string }> };

/** Remove um anexo (registro e arquivo). */
export const DELETE = protectedRoute<Ctx>(async (_req, { params }) => {
  const id = v.uuid((await params).id);
  const s = store();
  const [a] = await s.select<{ storage_path: string }>('attachments', { cols: 'storage_path', eq: { id } });
  if (!a) throw new ApiError(404, 'Anexo não encontrado.');
  await s.remove('attachments', { eq: { id } });
  await s.removeFile(a.storage_path).catch(() => {});
  return json({ ok: true });
});
