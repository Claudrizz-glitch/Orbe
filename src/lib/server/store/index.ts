import 'server-only';
import type { Store } from './types';
import { supabaseStore } from './supabase';
import { postgresStore } from './postgres';
import { localStore, flushLocal } from './local';

export type { Store, Table, Row, Filter, Query } from './types';

/**
 * Escolhe o armazenamento:
 *   ORBE_STORAGE=postgres → Postgres/Neon via DATABASE_URL (recomendado em produção)
 *   ORBE_STORAGE=supabase → Supabase
 *   ORBE_STORAGE=local    → pasta orbe-data/ (somente fora de produção)
 *   sem a variável        → postgres se DATABASE_URL existir; senão supabase se SUPABASE_URL; senão local.
 */
function mode(): string {
  const m = process.env.ORBE_STORAGE?.trim().toLowerCase();
  if (m === 'neon') return 'postgres';
  if (m) return m;
  if (process.env.DATABASE_URL?.trim()) return 'postgres';
  if (process.env.SUPABASE_URL?.trim()) return 'supabase';
  return 'local';
}

export function store(): Store {
  const m = mode();
  if (m === 'postgres') return postgresStore;
  if (m === 'supabase') return supabaseStore;
  if (process.env.NODE_ENV === 'production' && process.env.ORBE_ALLOW_LOCAL_IN_PROD !== '1') {
    throw new Error('Armazenamento local não é permitido em produção. Configure DATABASE_URL (Neon).');
  }
  return localStore;
}

export async function persist() {
  if (store().kind === 'local') await flushLocal();
}
