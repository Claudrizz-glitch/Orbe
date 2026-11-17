import 'server-only';
import { store, persist } from './store';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_IP = 5;      // por IP a cada 15 min
const MAX_FAILS_GLOBAL = 30;     // total a cada 15 min (ataques distribuídos)

/**
 * Limitação persistida (funciona em ambiente serverless, onde a memória
 * não é compartilhada entre instâncias).
 */
export async function checkLoginAllowed(ipHash: string): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const [fails, global] = await Promise.all([
    store().select<{ attempted_at: string }>('login_attempts', {
      cols: 'attempted_at', eq: { ip_hash: ipHash, success: false }, gte: { attempted_at: since },
      order: [{ col: 'attempted_at', asc: true }],
    }),
    store().count('login_attempts', { eq: { success: false }, gte: { attempted_at: since } }),
  ]);
  if (fails.length >= MAX_FAILS_PER_IP) {
    const oldest = new Date(fails[fails.length - MAX_FAILS_PER_IP].attempted_at).getTime();
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((oldest + WINDOW_MS - Date.now()) / 1000)) };
  }
  if (global >= MAX_FAILS_GLOBAL) return { allowed: false, retryAfterSec: Math.ceil(WINDOW_MS / 1000) };
  return { allowed: true, retryAfterSec: 0 };
}

export async function recordAttempt(ipHash: string, success: boolean) {
  await store().insert('login_attempts', [{ ip_hash: ipHash, success }]);
  await store().remove('login_attempts', { lt: { attempted_at: new Date(Date.now() - 7 * 864e5).toISOString() } });
  await persist();
}
