import 'server-only';
import postgres from 'postgres';
import type { Filter, Query, Row, Store, Table } from './types';
import { fileHeaders } from '../files';

/**
 * Armazenamento em Postgres (Neon). Conexão pela DATABASE_URL, apenas no servidor.
 * Nomes de colunas são validados contra uma lista fixa e todos os valores vão
 * como parâmetros — nada do usuário é concatenado no SQL.
 */
const COLS: Record<Table, string[]> = {
  spaces: ['id', 'name', 'icon', 'icon_path', 'color', 'appearance', 'position', 'created_at', 'updated_at'],
  categories: ['id', 'space_id', 'name', 'icon', 'color', 'collapsed', 'position', 'created_at', 'updated_at'],
  channels: ['id', 'space_id', 'category_id', 'name', 'icon', 'color', 'topic', 'sort_mode', 'position', 'kind', 'page_path', 'created_at', 'updated_at'],
  identities: ['id', 'name', 'avatar_path', 'description', 'color', 'is_owner', 'position', 'created_at', 'updated_at'],
  messages: ['id', 'channel_id', 'identity_id', 'reply_to_id', 'content', 'content_format', 'display_at', 'position', 'pinned_at', 'edited_at', 'source_ref', 'extra', 'created_at', 'updated_at'],
  attachments: ['id', 'message_id', 'storage_path', 'file_name', 'mime_type', 'size_bytes', 'width', 'height', 'position', 'created_at'],
  import_jobs: ['id', 'source', 'external_id', 'name', 'space_id', 'status', 'options', 'state', 'stats', 'log', 'error', 'created_at', 'updated_at', 'finished_at'],
  import_map: ['source', 'kind', 'external_id', 'local_id', 'created_at'],
  access_sessions: ['id', 'token_hash', 'user_agent', 'created_at', 'last_seen_at', 'expires_at'],
  login_attempts: ['id', 'ip_hash', 'success', 'attempted_at'],
  settings: ['key', 'value', 'updated_at'],
  page_history: ['id', 'channel_id', 'at', 'items', 'changes'],
};
const JSONB = new Set(['appearance', 'extra', 'options', 'state', 'stats', 'log', 'value', 'items', 'changes']);
const UUID_COL = (c: string) => c === 'id' || c === 'local_id' || (c.endsWith('_id') && c !== 'external_id');

type Sql = ReturnType<typeof postgres>;
const g = globalThis as unknown as { __orbePg?: Sql };

function isoFromPg(s: string) {
  const d = new Date(s.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

function sql(): Sql {
  if (g.__orbePg) return g.__orbePg;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL não configurada. Veja .env.example.');
  g.__orbePg = postgres(url, {
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require',
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false, // compatível com o pooler do Neon
    types: {
      ts: { to: 1184, from: [1114, 1184], serialize: (x: unknown) => (x instanceof Date ? x.toISOString() : String(x)), parse: isoFromPg },
      int8: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
    },
    onnotice: () => {},
  });
  return g.__orbePg;
}

function col(t: Table, c: string) {
  if (!COLS[t].includes(c)) throw new Error(`Coluna inválida: ${t}.${c}`);
  return `"${c}"`;
}
function colList(t: Table, spec?: string) {
  if (!spec || spec.trim() === '*') return '*';
  return spec.split(',').map((c) => col(t, c.trim())).join(', ');
}
function val(c: string, v: unknown, params: unknown[]) {
  // "::text" antes de "::jsonb": sem isso o driver vê um parâmetro jsonb e codifica
  // a string JSON de novo, gravando um texto em vez de um objeto.
  if (JSONB.has(c)) { params.push(JSON.stringify(v ?? {})); return `$${params.length}::text::jsonb`; }
  params.push(v);
  return `$${params.length}`;
}
function where(t: Table, f: Filter = {}, params: unknown[]): string {
  const parts: string[] = [];
  for (const [c, v] of Object.entries(f.eq ?? {})) {
    if (v === null) parts.push(`${col(t, c)} is null`);
    else { params.push(v); parts.push(`${col(t, c)} = $${params.length}`); }
  }
  for (const [c, list] of Object.entries(f.in ?? {})) {
    params.push(list);
    parts.push(`${col(t, c)} = any($${params.length}::${UUID_COL(c) ? 'uuid' : 'text'}[])`);
  }
  for (const [c, v] of Object.entries(f.gte ?? {})) { params.push(v); parts.push(`${col(t, c)} >= $${params.length}`); }
  for (const [c, v] of Object.entries(f.lt ?? {})) { params.push(v); parts.push(`${col(t, c)} < $${params.length}`); }
  return parts.length ? ` where ${parts.join(' and ')}` : '';
}
const hasFilter = (f: Filter) => Object.values(f).some((x) => x && Object.keys(x).length);


export const postgresStore: Store = {
  kind: 'postgres',

  async select<T>(t: Table, q: Query = {}) {
    const params: unknown[] = [];
    let text = `select ${colList(t, q.cols)} from "${t}"${where(t, q, params)}`;
    if (q.order?.length) text += ` order by ${q.order.map((o) => `${col(t, o.col)} ${o.asc === false ? 'desc' : 'asc'}`).join(', ')}`;
    if (q.limit !== undefined) { params.push(q.limit); text += ` limit $${params.length}`; }
    if (q.offset) { params.push(q.offset); text += ` offset $${params.length}`; }
    return (await sql().unsafe(text, params as never[])) as unknown as T[];
  },

  async count(t, f = {}) {
    const params: unknown[] = [];
    const [r] = await sql().unsafe(`select count(*)::int as n from "${t}"${where(t, f, params)}`, params as never[]);
    return (r as unknown as { n: number }).n;
  },

  async insert<T>(t: Table, rows: Row[], opts: { ignoreDuplicatesOn?: string; cols?: string } = {}) {
    if (!rows.length) return [];
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    keys.forEach((k) => col(t, k));
    const params: unknown[] = [];
    const values = rows.map((r) => `(${keys.map((k) => (k in r ? val(k, r[k], params) : 'default')).join(', ')})`).join(', ');
    let text = `insert into "${t}" (${keys.map((k) => `"${k}"`).join(', ')}) values ${values}`;
    if (opts.ignoreDuplicatesOn) text += ` on conflict (${col(t, opts.ignoreDuplicatesOn)}) do nothing`;
    text += ` returning ${colList(t, opts.cols)}`;
    return (await sql().unsafe(text, params as never[])) as unknown as T[];
  },

  async update<T>(t: Table, f: Filter, patch: Row, cols?: string) {
    if (!hasFilter(f)) throw new Error('Atualização sem filtro bloqueada.');
    const keys = Object.keys(patch);
    if (!keys.length) return [];
    const params: unknown[] = [];
    const set = keys.map((k) => `${col(t, k)} = ${val(k, patch[k], params)}`).join(', ');
    const text = `update "${t}" set ${set}${where(t, f, params)} returning ${colList(t, cols)}`;
    return (await sql().unsafe(text, params as never[])) as unknown as T[];
  },

  async remove(t, f) {
    if (!hasFilter(f)) throw new Error('Exclusão sem filtro bloqueada.');
    const params: unknown[] = [];
    const [r] = await sql().unsafe(`with d as (delete from "${t}"${where(t, f, params)} returning 1) select count(*)::int as n from d`, params as never[]);
    return (r as unknown as { n: number }).n;
  },

  async reorder(t, ids) {
    if (!['spaces', 'categories', 'channels', 'identities', 'messages'].includes(t)) throw new Error('Tabela não permitida.');
    await sql().unsafe(
      `update "${t}" x set position = o.ord - 1 from unnest($1::uuid[]) with ordinality as o(id, ord) where x.id = o.id`,
      [ids] as never[],
    );
  },

  async moveChannel(channelId, categoryId, orderedIds) {
    await sql().begin(async (tx) => {
      await tx.unsafe('update channels set category_id = $1 where id = $2', [categoryId, channelId] as never[]);
      await tx.unsafe(
        'update channels x set position = o.ord - 1 from unnest($1::uuid[]) with ordinality as o(id, ord) where x.id = o.id',
        [orderedIds] as never[],
      );
    });
  },

  async putFile(path, data, contentType) {
    await sql().unsafe(
      `insert into files (path, content_type, size_bytes, data) values ($1, $2, $3, $4)
       on conflict (path) do update set content_type = excluded.content_type, size_bytes = excluded.size_bytes, data = excluded.data`,
      [path, contentType, data.byteLength, Buffer.from(data)] as never[],
    );
  },

  async appendFile(path, data) {
    const r = await sql().unsafe(
      'update files set data = data || $2, size_bytes = size_bytes + $3 where path = $1 returning 1',
      [path, Buffer.from(data), data.byteLength] as never[],
    );
    if (!r.length) throw new Error('Envio não iniciado (parte inicial ausente).');
  },

  async copyFile(from, to) {
    await sql().unsafe(
      `insert into files (path, content_type, size_bytes, data) select $2, content_type, size_bytes, data from files where path = $1
       on conflict (path) do nothing`,
      [from, to] as never[],
    );
  },

  async fileSize(path) {
    const [r] = await sql().unsafe('select octet_length(data)::int as n from files where path = $1', [path] as never[]);
    return r ? (r as unknown as { n: number }).n : null;
  },

  async removeFile(path) {
    await sql().unsafe('delete from files where path = $1', [path] as never[]);
  },

  async fileResponse(path, opts = {}) {
    const [f] = await sql().unsafe('select content_type, octet_length(data)::int as n from files where path = $1', [path] as never[]);
    if (!f) return new Response(JSON.stringify({ error: 'Arquivo não encontrado.' }), { status: 404 });
    const total = Number(f.n);
    const headers = fileHeaders(path, String(f.content_type), total, opts);
    // Envia em pedaços de 1 MB: não carrega o arquivo inteiro na memória e não
    // esbarra no limite de resposta das funções da Vercel
    const SLICE = 1024 * 1024;
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        if (offset >= total) { ctrl.close(); return; }
        const [c] = await sql().unsafe('select substring(data from $2 for $3) as d from files where path = $1', [path, offset + 1, SLICE] as never[]);
        const chunk = new Uint8Array((c as unknown as { d: Buffer }).d);
        offset += chunk.byteLength || SLICE;
        if (chunk.byteLength) ctrl.enqueue(chunk);
        if (offset >= total || !chunk.byteLength) ctrl.close();
      },
    });
    return new Response(stream, { headers });
  },
};
