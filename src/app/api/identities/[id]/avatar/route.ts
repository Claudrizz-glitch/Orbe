import { randomBytes } from 'node:crypto';
import { ApiError, json, protectedRoute } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { IDENTITY_COLS, type Identity } from '@/lib/types';
import { sniffImage as sniff } from '@/lib/server/files';

type Ctx = { params: Promise<{ id: string }> };

const MAX = 4 * 1024 * 1024; // limite do corpo de requisição na Vercel é ~4,5 MB

async function current(id: string) {
  const [idn] = await store().select<Identity>('identities', { cols: IDENTITY_COLS, eq: { id } });
  if (!idn) throw new ApiError(404, 'Identidade não encontrada.');
  return idn;
}

/** Envia/substitui o avatar (multipart, campo "file"). */
export const POST = protectedRoute<Ctx>(async (req, { params }) => {
  const id = v.uuid((await params).id);
  const idn = await current(id);
  let file: File | null = null;
  try { file = (await req.formData()).get('file') as File | null; } catch { /* corpo inválido */ }
  if (!file || typeof file === 'string') throw new ApiError(400, 'Envie uma imagem.');
  if (file.size > MAX) throw new ApiError(413, 'A imagem pode ter no máximo 4 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(bytes);
  if (!kind) throw new ApiError(400, 'Formato não suportado. Use PNG, JPG, GIF ou WEBP.');

  const s = store();
  const path = `avatars/${id}-${randomBytes(4).toString('hex')}.${kind.ext}`;
  await s.putFile(path, bytes, kind.type);
  const [row] = await s.update<Identity>('identities', { eq: { id } }, { avatar_path: path }, IDENTITY_COLS);
  if (idn.avatar_path && idn.avatar_path !== path) await s.removeFile(idn.avatar_path).catch(() => {});
  return json(row);
});

export const DELETE = protectedRoute<Ctx>(async (_req, { params }) => {
  const id = v.uuid((await params).id);
  const idn = await current(id);
  const [row] = await store().update<Identity>('identities', { eq: { id } }, { avatar_path: null }, IDENTITY_COLS);
  if (idn.avatar_path) await store().removeFile(idn.avatar_path).catch(() => {});
  return json(row);
});
