import { randomBytes } from 'node:crypto';
import { ApiError, json, protectedRoute } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { IDENTITY_COLS, type Identity } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

const MAX = 4 * 1024 * 1024; // limite do corpo de requisição na Vercel é ~4,5 MB

/** Identifica o formato pelos primeiros bytes (não confia no nome nem no tipo enviado). */
function sniff(b: Uint8Array): { ext: string; type: string } | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', type: 'image/png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { ext: 'gif', type: 'image/gif' };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { ext: 'webp', type: 'image/webp' };
  return null;
}

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
