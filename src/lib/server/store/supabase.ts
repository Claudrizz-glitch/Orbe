import 'server-only';
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env';
import type { Filter, Query, Row, Store, Table } from './types';

export const BUCKET = 'orbe-files';

let client: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilter<Q extends { eq: any; is: any; in: any; gte: any; lt: any }>(q: Q, f: Filter = {}): Q {
  for (const [k, v] of Object.entries(f.eq ?? {})) q = v === null ? q.is(k, null) : q.eq(k, v);
  for (const [k, v] of Object.entries(f.in ?? {})) q = q.in(k, v);
  for (const [k, v] of Object.entries(f.gte ?? {})) q = q.gte(k, v);
  for (const [k, v] of Object.entries(f.lt ?? {})) q = q.lt(k, v);
  return q;
}

export const supabaseStore: Store = {
  kind: 'supabase',

  async select<T>(table: Table, q: Query = {}) {
    let b = applyFilter(db().from(table).select(q.cols ?? '*'), q);
    for (const o of q.order ?? []) b = b.order(o.col, { ascending: o.asc !== false });
    if (q.limit !== undefined) b = b.range(q.offset ?? 0, (q.offset ?? 0) + q.limit - 1);
    const { data, error } = await b;
    if (error) throw error;
    return (data ?? []) as T[];
  },

  async count(table, f) {
    const { count, error } = await applyFilter(db().from(table).select('*', { count: 'exact', head: true }), f);
    if (error) throw error;
    return count ?? 0;
  },

  async insert<T>(table: Table, rows: Row[], opts: { ignoreDuplicatesOn?: string; cols?: string } = {}) {
    if (!rows.length) return [];
    const b = opts.ignoreDuplicatesOn
      ? db().from(table).upsert(rows, { onConflict: opts.ignoreDuplicatesOn, ignoreDuplicates: true })
      : db().from(table).insert(rows);
    const { data, error } = await b.select(opts.cols ?? '*');
    if (error) throw error;
    return (data ?? []) as T[];
  },

  async update<T>(table: Table, f: Filter, patch: Row, cols?: string) {
    const { data, error } = await applyFilter(db().from(table).update(patch), f).select(cols ?? '*');
    if (error) throw error;
    return (data ?? []) as T[];
  },

  async remove(table, f) {
    const { data, error } = await applyFilter(db().from(table).delete(), f).select('*');
    if (error) throw error;
    return data?.length ?? 0;
  },

  async reorder(table, ids) {
    const { error } = await db().rpc('orbe_reorder', { p_table: table, p_ids: ids });
    if (error) throw error;
  },

  async moveChannel(channelId, categoryId, orderedIds) {
    const { error } = await db().rpc('orbe_move_channel', { p_channel_id: channelId, p_category_id: categoryId, p_ordered_ids: orderedIds });
    if (error) throw error;
  },

  async putFile(path, data, contentType) {
    const { error } = await db().storage.from(BUCKET).upload(path, data, { contentType, upsert: true });
    if (error) throw error;
  },

  async appendFile() {
    throw new Error('Envio de anexos em partes não é suportado no modo Supabase. Use ORBE_STORAGE=postgres.');
  },

  async copyFile(from, to) {
    const { error } = await db().storage.from(BUCKET).copy(from, to);
    if (error) throw error;
  },

  async fileSize() {
    return null;
  },

  async removeFile(path) {
    await db().storage.from(BUCKET).remove([path]);
  },

  async fileResponse(path, opts = {}) {
    const { data, error } = await db().storage.from(BUCKET).createSignedUrl(path, 300, opts.download ? { download: opts.download } : undefined);
    if (error || !data) return NextResponse.json({ error: 'Arquivo não encontrado.' }, { status: 404 });
    const res = NextResponse.redirect(data.signedUrl, 302);
    res.headers.set('Cache-Control', 'private, max-age=240');
    return res;
  },
};
