import 'server-only';
import { scrypt, timingSafeEqual } from 'node:crypto';

function scryptAsync(pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Verifica a senha contra o hash "scrypt:N:r:p:salt:hash" gerado por scripts/hash-password.mjs. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    throw new Error('ORBE_PASSWORD_HASH em formato inválido. Gere novamente com npm run hash-password.');
  }
  const [, nS, rS, pS, saltB64, keyB64] = parts;
  const N = Number(nS), r = Number(rS), p = Number(pS);
  const salt = Buffer.from(saltB64, 'base64url');
  const expected = Buffer.from(keyB64, 'base64url');
  const actual = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
    N, r, p, maxmem: 128 * N * r * 2,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
