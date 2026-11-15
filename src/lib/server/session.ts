import 'server-only';
import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from './db';
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

/** Cria a sessão no banco e devolve o token bruto (vai apenas para o cookie). */
export async function createSession(userAgent: string | null) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  const { error } = await db().from('access_sessions').insert({
    token_hash: sha256(token),
    user_agent: userAgent?.slice(0, 300) ?? null,
    expires_at: expires.toISOString(),
  });
  if (error) throw error;
  // limpeza oportunista de sessões expiradas
  void db().from('access_sessions').delete().lt('expires_at', new Date().toISOString()).then(() => {});
  return { token, expires };
}

/** Valida o cookie de sessão contra o banco. Retorna true se a sessão é válida. */
export async function hasValidSession(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return false;
  const { data, error } = await db()
    .from('access_sessions')
    .select('id, expires_at, last_seen_at')
    .eq('token_hash', sha256(token))
    .maybeSingle();
  // Falha de banco ≠ sessão inválida: propaga o erro (500 / tela "tentar novamente")
  // em vez de deslogar o usuário por uma instabilidade temporária.
  if (error) throw error;
  if (!data) return false;
  if (new Date(data.expires_at).getTime() <= Date.now()) return false;
  if (Date.now() - new Date(data.last_seen_at).getTime() > TOUCH_INTERVAL_MS) {
    void db().from('access_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id).then(() => {});
  }
  return true;
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db().from('access_sessions').delete().eq('token_hash', sha256(token));
  store.delete(SESSION_COOKIE);
}

export function hashIp(ip: string) {
  return sha256(`${env.sessionSecret}|${ip}`);
}
