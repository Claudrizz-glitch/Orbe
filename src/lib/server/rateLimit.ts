import 'server-only';
import { db } from './db';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_IP = 5;      // por IP a cada 15 min
const MAX_FAILS_GLOBAL = 30;     // total a cada 15 min (ataques distribuídos)

/**
 * Limitação persistida no banco (funciona em ambiente serverless,
 * onde a memória não é compartilhada entre instâncias).
 */
export async function checkLoginAllowed(ipHash: string): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const [perIp, global] = await Promise.all([
    db().from('login_attempts').select('attempted_at')
      .eq('ip_hash', ipHash).eq('success', false).gte('attempted_at', since)
      .order('attempted_at', { ascending: true }),
    db().from('login_attempts').select('id', { count: 'exact', head: true })
      .eq('success', false).gte('attempted_at', since),
  ]);
  if (perIp.error) throw perIp.error;
  if (global.error) throw global.error;

  const fails = perIp.data ?? [];
  if (fails.length >= MAX_FAILS_PER_IP) {
    const oldest = new Date(fails[fails.length - MAX_FAILS_PER_IP].attempted_at).getTime();
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((oldest + WINDOW_MS - Date.now()) / 1000)) };
  }
  if ((global.count ?? 0) >= MAX_FAILS_GLOBAL) {
    return { allowed: false, retryAfterSec: Math.ceil(WINDOW_MS / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export async function recordAttempt(ipHash: string, success: boolean) {
  await db().from('login_attempts').insert({ ip_hash: ipHash, success });
  // Mantém a tabela pequena
  const cutoff = new Date(Date.now() - 7 * 864e5).toISOString();
  void db().from('login_attempts').delete().lt('attempted_at', cutoff).then(() => {});
}
