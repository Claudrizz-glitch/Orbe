import { ApiError, json, protectedRoute } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { MAX_ATTACHMENT, MAX_CHUNK, attachmentType, safeName } from '@/lib/server/files';
import type { Attachment } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 60;
const ATT_COLS = 'id, message_id, storage_path, file_name, mime_type, size_bytes, width, height';

/**
 * Envio de anexo em partes (cada requisição ≤ 3,5 MB, para caber no limite da Vercel).
 * Query: upload=<uuid>&name=<arquivo>&type=<mime>&size=<bytes>&part=<i>&parts=<n>[&w=&h=]
 * Corpo: os bytes da parte. A última parte valida o tamanho e cria o anexo.
 */
export const POST = protectedRoute<Ctx>(async (req, { params }) => {
  const messageId = v.uuid((await params).id);
  const q = req.nextUrl.searchParams;
  const upload = v.uuid(q.get('upload'), 'Envio');
  const name = (q.get('name') ?? '').trim().slice(0, 255);
  if (!name) throw new ApiError(400, 'Nome do arquivo ausente.');
  const size = Number(q.get('size'));
  const part = Number(q.get('part'));
  const parts = Number(q.get('parts'));
  if (!Number.isInteger(size) || size < 1) throw new ApiError(400, 'Arquivo vazio.');
  if (size > MAX_ATTACHMENT) throw new ApiError(413, 'Cada arquivo pode ter no máximo 25 MB.');
  if (!Number.isInteger(parts) || parts < 1 || parts > 10 || !Number.isInteger(part) || part < 0 || part >= parts) throw new ApiError(400, 'Parte inválida.');

  const s = store();
  if (!(await s.count('messages', { eq: { id: messageId } }))) throw new ApiError(404, 'Mensagem não encontrada.');

  const chunk = new Uint8Array(await req.arrayBuffer());
  if (!chunk.byteLength) throw new ApiError(400, 'Parte vazia.');
  if (chunk.byteLength > MAX_CHUNK) throw new ApiError(413, 'Parte grande demais.');

  const path = `attachments/${messageId}/${upload}-${safeName(name)}`;
  if (part === 0) {
    await s.putFile(path, chunk, attachmentType(q.get('type') ?? '', chunk));
  } else {
    if ((await s.fileSize(path)) === null) throw new ApiError(409, 'Envio interrompido. Tente anexar de novo.');
    await s.appendFile(path, chunk);
  }
  if (part < parts - 1) return json({ done: false });

  // Última parte: confere o arquivo completo e registra o anexo
  const actual = await s.fileSize(path);
  if (actual !== null && actual !== size) {
    await s.removeFile(path).catch(() => {});
    throw new ApiError(400, 'O arquivo chegou incompleto. Tente de novo.');
  }
  // Reenvio da última parte (ex.: resposta perdida): não duplica o registro
  const [existing] = await s.select<Attachment>('attachments', { cols: ATT_COLS, eq: { storage_path: path } });
  if (existing) return json({ done: true, attachment: existing });

  const dim = (k: string) => { const n = Number(q.get(k)); return Number.isInteger(n) && n > 0 && n < 100000 ? n : null; };
  const position = await s.count('attachments', { eq: { message_id: messageId } });
  const [row] = await s.insert<Attachment>('attachments', [{
    message_id: messageId, storage_path: path, file_name: name, size_bytes: size,
    mime_type: await mimeOf(path, q.get('type') ?? ''), width: dim('w'), height: dim('h'), position,
  }], { cols: ATT_COLS });
  return json({ done: true, attachment: row }, 201);
});

/** Tipo gravado junto do arquivo na parte 0 (lido de volta para o registro do anexo). */
async function mimeOf(path: string, claimed: string): Promise<string> {
  const res = await store().fileResponse(path);
  const t = res.headers.get('content-type') ?? claimed;
  await res.body?.cancel().catch(() => {});
  return t.split(';')[0] || 'application/octet-stream';
}
