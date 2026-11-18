import { randomUUID } from 'node:crypto';
import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { MAX_ATTACHMENT, MAX_CHUNK } from '@/lib/server/files';
import { CHANNEL_COLS, type Channel } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 60;
const HTML_TYPE = 'text/html; charset=utf-8';

async function getChannel(id: string) {
  const [ch] = await store().select<Channel>('channels', { cols: CHANNEL_COLS, eq: { id } });
  if (!ch) throw new ApiError(404, 'Canal não encontrado.');
  return ch;
}

/** Define o novo documento da página e apaga o anterior. */
async function setPage(ch: Channel, path: string) {
  const [row] = await store().update<Channel>('channels', { eq: { id: ch.id } }, { kind: 'page', page_path: path }, CHANNEL_COLS);
  if (ch.page_path && ch.page_path !== path) await store().removeFile(ch.page_path).catch(() => {});
  return row;
}

/**
 * Define o conteúdo HTML de um canal-página.
 *  - Corpo JSON { from_attachment: uuid } → usa (copia) um anexo HTML existente
 *  - Corpo binário em partes (como os anexos):
 *      ?upload=<uuid>&size=<bytes>&part=<i>&parts=<n>   (o HTML editado ou um arquivo enviado)
 */
export const POST = protectedRoute<Ctx>(async (req, { params }) => {
  const ch = await getChannel(v.uuid((await params).id));
  const s = store();

  if ((req.headers.get('content-type') ?? '').includes('application/json')) {
    const b = await readBody(req);
    const attId = v.uuid(b.from_attachment, 'Anexo');
    const [a] = await s.select<{ storage_path: string; size_bytes: number }>('attachments', { cols: 'storage_path, size_bytes', eq: { id: attId } });
    if (!a) throw new ApiError(404, 'Anexo não encontrado.');
    const path = `pages/${ch.id}/${randomUUID()}.html`;
    await s.copyFile(a.storage_path, path);
    return json(await setPage(ch, path));
  }

  const q = req.nextUrl.searchParams;
  const upload = v.uuid(q.get('upload'), 'Envio');
  const size = Number(q.get('size'));
  const part = Number(q.get('part'));
  const parts = Number(q.get('parts'));
  if (!Number.isInteger(size) || size < 1) throw new ApiError(400, 'Página vazia.');
  if (size > MAX_ATTACHMENT) throw new ApiError(413, 'A página pode ter no máximo 25 MB.');
  if (!Number.isInteger(parts) || parts < 1 || parts > 10 || !Number.isInteger(part) || part < 0 || part >= parts) throw new ApiError(400, 'Parte inválida.');
  const chunk = new Uint8Array(await req.arrayBuffer());
  if (!chunk.byteLength || chunk.byteLength > MAX_CHUNK) throw new ApiError(413, 'Parte inválida.');

  const path = `pages/${ch.id}/${upload}.html`;
  if (part === 0) await s.putFile(path, chunk, HTML_TYPE);
  else {
    if ((await s.fileSize(path)) === null) throw new ApiError(409, 'Envio interrompido. Tente de novo.');
    await s.appendFile(path, chunk);
  }
  if (part < parts - 1) return json({ done: false });
  const actual = await s.fileSize(path);
  if (actual !== null && actual !== size) {
    await s.removeFile(path).catch(() => {});
    throw new ApiError(400, 'A página chegou incompleta. Tente de novo.');
  }
  return json({ done: true, channel: await setPage(ch, path) });
});
