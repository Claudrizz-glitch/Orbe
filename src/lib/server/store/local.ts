import 'server-only';
import { randomUUID } from 'node:crypto';
import { promises as fs, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Filter, Query, Row, Store, Table } from './types';

/**
 * Armazenamento local em disco — pasta orbe-data/ na raiz do projeto.
 *   orbe-data/db/<tabela>.json   dados
 *   orbe-data/files/...          anexos, avatares, ícones
 * Serve como backup completo e portátil; pode ser restaurado no Supabase depois.
 * Usado apenas fora de produção (a Vercel não tem disco persistente).
 */
const ROOT = path.resolve(process.cwd(), process.env.ORBE_LOCAL_DIR || 'orbe-data');
const DB_DIR = path.join(ROOT, 'db');
const FILES_DIR = path.join(ROOT, 'files');

const TABLES: Table[] = ['spaces', 'categories', 'channels', 'identities', 'messages', 'attachments', 'import_jobs', 'import_map', 'access_sessions', 'login_attempts'];

type Data = Record<Table, Row[]>;
interface State { data: Data; dirty: Set<Table>; timer: NodeJS.Timeout | null; writing: Promise<void> }
const g = globalThis as unknown as { __orbeLocal?: State };

function load(): State {
  if (g.__orbeLocal) return g.__orbeLocal;
  mkdirSync(DB_DIR, { recursive: true });
  mkdirSync(FILES_DIR, { recursive: true });
  const data = {} as Data;
  for (const t of TABLES) {
    const f = path.join(DB_DIR, `${t}.json`);
    data[t] = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
  }
  if (!data.identities.some((i) => i.is_owner)) {
    data.identities.push(defaults('identities', { name: 'Eu', is_owner: true }));
    g.__orbeLocal = { data, dirty: new Set(['identities']), timer: null, writing: Promise.resolve() };
    schedule();
    return g.__orbeLocal;
  }
  g.__orbeLocal = { data, dirty: new Set(), timer: null, writing: Promise.resolve() };
  return g.__orbeLocal;
}

/** Grava em arquivo temporário e renomeia: nunca deixa um JSON pela metade. */
async function flush() {
  const s = load();
  s.timer = null;
  const tables = [...s.dirty];
  s.dirty.clear();
  s.writing = s.writing.then(async () => {
    for (const t of tables) {
      const f = path.join(DB_DIR, `${t}.json`);
      const tmp = `${f}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(s.data[t]));
      await fs.rename(tmp, f);
    }
  });
  await s.writing;
}
function schedule() {
  const s = load();
  if (!s.timer) s.timer = setTimeout(() => { void flush(); }, 300);
}
function touch(t: Table) { load().dirty.add(t); schedule(); }

const now = () => new Date().toISOString();

function defaults(t: Table, r: Row): Row {
  const base: Row = {};
  const ts = now();
  switch (t) {
    case 'spaces': Object.assign(base, { id: randomUUID(), icon: null, icon_path: null, color: null, appearance: {}, position: 0, created_at: ts, updated_at: ts }); break;
    case 'categories': Object.assign(base, { id: randomUUID(), icon: null, color: null, collapsed: false, position: 0, created_at: ts, updated_at: ts }); break;
    case 'channels': Object.assign(base, { id: randomUUID(), category_id: null, icon: null, color: null, topic: null, sort_mode: 'manual', position: 0, created_at: ts, updated_at: ts }); break;
    case 'identities': Object.assign(base, { id: randomUUID(), avatar_path: null, description: null, color: null, is_owner: false, position: 0, created_at: ts, updated_at: ts }); break;
    case 'messages': Object.assign(base, { id: randomUUID(), identity_id: null, reply_to_id: null, content: '', content_format: 'markdown', display_at: ts, position: 0, pinned_at: null, edited_at: null, source_ref: null, extra: {}, created_at: ts, updated_at: ts }); break;
    case 'attachments': Object.assign(base, { id: randomUUID(), mime_type: 'application/octet-stream', size_bytes: 0, width: null, height: null, position: 0, created_at: ts }); break;
    case 'import_jobs': Object.assign(base, { id: randomUUID(), space_id: null, status: 'running', options: {}, state: {}, stats: {}, log: [], error: null, created_at: ts, updated_at: ts, finished_at: null }); break;
    case 'import_map': Object.assign(base, { created_at: ts }); break;
    case 'access_sessions': Object.assign(base, { id: randomUUID(), user_agent: null, created_at: ts, last_seen_at: ts }); break;
    case 'login_attempts': Object.assign(base, { id: Date.now() + Math.random(), attempted_at: ts }); break;
  }
  return { ...base, ...r };
}

function match(r: Row, f: Filter = {}): boolean {
  for (const [k, v] of Object.entries(f.eq ?? {})) if ((r[k] ?? null) !== v) return false;
  for (const [k, v] of Object.entries(f.in ?? {})) if (!v.includes(r[k])) return false;
  for (const [k, v] of Object.entries(f.gte ?? {})) if (!((r[k] as string | number) >= v)) return false;
  for (const [k, v] of Object.entries(f.lt ?? {})) if (!((r[k] as string | number) < v)) return false;
  return true;
}

function project<T>(r: Row, cols?: string): T {
  if (!cols || cols === '*') return structuredClone(r) as T;
  const out: Row = {};
  for (const c of cols.split(',').map((s) => s.trim())) out[c] = structuredClone(r[c] ?? null);
  return out as T;
}

const UNIQUE: Partial<Record<Table, string[][]>> = {
  messages: [['source_ref']],
  attachments: [['storage_path']],
  import_map: [['source', 'kind', 'external_id']],
  access_sessions: [['token_hash']],
};

function conflicts(t: Table, row: Row, list: Row[]): boolean {
  return (UNIQUE[t] ?? []).some((cols) =>
    cols.every((c) => row[c] != null) && list.some((x) => cols.every((c) => x[c] === row[c])));
}

/** Exclusões em cascata equivalentes às FKs do Postgres. */
function cascade(t: Table, ids: Set<unknown>) {
  const d = load().data;
  const drop = (tt: Table, pred: (r: Row) => boolean) => {
    const gone = new Set(d[tt].filter(pred).map((r) => r.id));
    if (!gone.size) return gone;
    d[tt] = d[tt].filter((r) => !gone.has(r.id));
    touch(tt);
    return gone;
  };
  if (t === 'spaces') {
    drop('categories', (r) => ids.has(r.space_id));
    const ch = drop('channels', (r) => ids.has(r.space_id));
    if (ch.size) cascade('channels', ch);
    d.import_jobs.forEach((j) => { if (ids.has(j.space_id)) j.space_id = null; });
  }
  if (t === 'categories') d.channels.forEach((c) => { if (ids.has(c.category_id)) { c.category_id = null; touch('channels'); } });
  if (t === 'channels') { const m = drop('messages', (r) => ids.has(r.channel_id)); if (m.size) cascade('messages', m); }
  if (t === 'messages') {
    drop('attachments', (r) => ids.has(r.message_id));
    d.messages.forEach((m) => { if (ids.has(m.reply_to_id)) m.reply_to_id = null; });
  }
  if (t === 'identities') d.messages.forEach((m) => { if (ids.has(m.identity_id)) { m.identity_id = null; touch('messages'); } });
  if (ids.size) {
    const keep = new Set(ids);
    d.import_map = d.import_map.filter((r) => !keep.has(r.local_id));
    touch('import_map');
  }
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
  pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', json: 'application/json',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
};

function safeFilePath(p: string) {
  const full = path.resolve(FILES_DIR, p);
  if (!full.startsWith(FILES_DIR + path.sep)) throw new Error('Caminho inválido');
  return full;
}

export const localStore: Store = {
  kind: 'local',

  async select<T>(t: Table, q: Query = {}) {
    let rows = load().data[t].filter((r) => match(r, q));
    if (q.order?.length) {
      rows = [...rows].sort((a, b) => {
        for (const o of q.order!) {
          const av = a[o.col] as never, bv = b[o.col] as never;
          if (av === bv) continue;
          const c = av == null ? 1 : bv == null ? -1 : av < bv ? -1 : 1;
          return o.asc === false ? -c : c;
        }
        return 0;
      });
    }
    if (q.limit !== undefined) rows = rows.slice(q.offset ?? 0, (q.offset ?? 0) + q.limit);
    return rows.map((r) => project<T>(r, q.cols));
  },

  async count(t, f) {
    return load().data[t].filter((r) => match(r, f)).length;
  },

  async insert<T>(t: Table, rows: Row[], opts: { ignoreDuplicatesOn?: string; cols?: string } = {}) {
    const list = load().data[t];
    const out: T[] = [];
    for (const r of rows) {
      const row = defaults(t, r);
      if (conflicts(t, row, list)) {
        if (opts.ignoreDuplicatesOn) continue;
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      list.push(row);
      out.push(project<T>(row, opts.cols));
    }
    if (out.length) touch(t);
    return out;
  },

  async update<T>(t: Table, f: Filter, patch: Row, cols?: string) {
    const out: T[] = [];
    const hasUpdated = ['spaces', 'categories', 'channels', 'identities', 'messages', 'import_jobs'].includes(t);
    for (const r of load().data[t]) {
      if (!match(r, f)) continue;
      Object.assign(r, structuredClone(patch), hasUpdated ? { updated_at: now() } : {});
      out.push(project<T>(r, cols));
    }
    if (out.length) touch(t);
    return out;
  },

  async remove(t, f) {
    const d = load().data;
    const gone = d[t].filter((r) => match(r, f));
    if (!gone.length) return 0;
    const ids = new Set(gone.map((r) => r.id));
    d[t] = d[t].filter((r) => !match(r, f));
    touch(t);
    if (t !== 'import_map') cascade(t, ids);
    return gone.length;
  },

  async reorder(t, ids) {
    const pos = new Map(ids.map((id, i) => [id, i]));
    for (const r of load().data[t]) if (pos.has(r.id as string)) r.position = pos.get(r.id as string);
    touch(t);
  },

  async moveChannel(channelId, categoryId, orderedIds) {
    const ch = load().data.channels.find((c) => c.id === channelId);
    if (ch) ch.category_id = categoryId;
    await this.reorder('channels', orderedIds);
  },

  async putFile(p, data) {
    const full = safeFilePath(p);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
  },

  async appendFile(p, data) {
    await fs.appendFile(safeFilePath(p), data);
  },

  async copyFile(from, to) {
    const dst = safeFilePath(to);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(safeFilePath(from), dst);
  },

  async fileSize(p) {
    try { return (await fs.stat(safeFilePath(p))).size; } catch { return null; }
  },

  async removeFile(p) {
    await fs.rm(safeFilePath(p), { force: true });
  },

  async fileResponse(p, opts = {}) {
    let buf: Buffer;
    try { buf = await fs.readFile(safeFilePath(p)); }
    catch { return new Response(JSON.stringify({ error: 'Arquivo não encontrado.' }), { status: 404 }); }
    const ext = p.split('.').pop()?.toLowerCase() ?? '';
    const headers: Record<string, string> = {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    };
    // SVG e HTML nunca são exibidos inline (evita execução de scripts embutidos)
    if (opts.download || ext === 'svg' || ext === 'html' || ext === 'htm') {
      headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(opts.download ?? path.basename(p))}`;
    }
    return new Response(new Uint8Array(buf), { headers });
  },
};

/** Garante que tudo foi gravado (usado ao fim de cada etapa de importação). */
export async function flushLocal() {
  if (g.__orbeLocal?.dirty.size) await flush();
  else await g.__orbeLocal?.writing;
}
