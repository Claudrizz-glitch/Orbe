import 'server-only';
import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { store, persist } from './store';
import { env } from './env';

export const SESSION_COOKIE = 'orbe_session';
const SESSION_DAYS = 30;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000; // atualiza last_seen no máximo 1x/hora

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'lax' as const,
    path: '/',
    expires,
  };
}

/** Cria a sessão e devolve o token bruto (vai apenas para o cookie). */
export async function createSession(userAgent: string | null) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await store().insert('access_sessions', [{
    token_hash: sha256(token),
    user_agent: userAgent?.slice(0, 300) ?? null,
    expires_at: expires.toISOString(),
  }]);
  await store().remove('access_sessions', { lt: { expires_at: new Date().toISOString() } });
  await persist();
  return { token, expires };
}

/**
 * Valida o cookie de sessão. Falhas do armazenamento são propagadas
 * (tela "tentar novamente") em vez de deslogar o usuário.
 */
export async function hasValidSession(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return false;
  const [s] = await store().select<{ id: string; expires_at: string; last_seen_at: string }>('access_sessions', {
    cols: 'id, expires_at, last_seen_at', eq: { token_hash: sha256(token) }, limit: 1,
  });
  if (!s) return false;
  if (new Date(s.expires_at).getTime() <= Date.now()) return false;
  if (Date.now() - new Date(s.last_seen_at).getTime() > TOUCH_INTERVAL_MS) {
    await store().update('access_sessions', { eq: { id: s.id } }, { last_seen_at: new Date().toISOString() }, 'id');
  }
  return true;
}

export async function destroySession() {
  const c = await cookies();
  const token = c.get(SESSION_COOKIE)?.value;
  if (token) {
    await store().remove('access_sessions', { eq: { token_hash: sha256(token) } });
    await persist();
  }
  c.delete(SESSION_COOKIE);
}

export function hashIp(ip: string) {
  return sha256(`${env.sessionSecret}|${ip}`);
}
