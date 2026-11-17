import 'server-only';
import type { Store } from './types';
import { supabaseStore } from './supabase';
import { localStore, flushLocal } from './local';

export type { Store, Table, Row, Filter, Query } from './types';

/**
 * Escolhe o armazenamento:
 *   ORBE_STORAGE=supabase → Supabase (obrigatório em produção)
 *   ORBE_STORAGE=local    → pasta orbe-data/ (somente fora de produção)
 *   sem a variável        → Supabase se SUPABASE_URL estiver definida; senão local.
 */
export function store(): Store {
  const mode = process.env.ORBE_STORAGE?.trim() || (process.env.SUPABASE_URL?.trim() ? 'supabase' : 'local');
  if (mode === 'local') {
    if (process.env.NODE_ENV === 'production' && process.env.ORBE_ALLOW_LOCAL_IN_PROD !== '1') {
      throw new Error('Armazenamento local não é permitido em produção. Configure o Supabase.');
    }
    return localStore;
  }
  return supabaseStore;
}

export async function persist() {
  if (store().kind === 'local') await flushLocal();
}
