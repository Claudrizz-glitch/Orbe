// Copia tudo da pasta orbe-data/ (modo local) para o Postgres (Neon).
// Idempotente: itens já copiados são ignorados (mesmo ID). Não apaga nada em nenhum lado.
// Uso: npm run db:import-local
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { connect } from './_env.mjs';

const ROOT = path.resolve(process.env.ORBE_LOCAL_DIR || 'orbe-data');
const read = (t) => {
  const f = path.join(ROOT, 'db', `${t}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
};
if (!existsSync(path.join(ROOT, 'db'))) {
  console.error(`Pasta ${ROOT} não encontrada.`);
  process.exit(1);
}

const sql = await connect();
const JSONB = new Set(['appearance', 'extra', 'options', 'state', 'stats', 'log']);
const COLS = {
  identities: ['id', 'name', 'avatar_path', 'description', 'color', 'is_owner', 'position', 'created_at', 'updated_at'],
  spaces: ['id', 'name', 'icon', 'icon_path', 'color', 'appearance', 'position', 'created_at', 'updated_at'],
  categories: ['id', 'space_id', 'name', 'icon', 'color', 'collapsed', 'position', 'created_at', 'updated_at'],
  channels: ['id', 'space_id', 'category_id', 'name', 'icon', 'color', 'topic', 'sort_mode', 'position', 'created_at', 'updated_at'],
  messages: ['id', 'channel_id', 'identity_id', 'content', 'content_format', 'display_at', 'position', 'pinned_at', 'edited_at', 'source_ref', 'extra', 'created_at', 'updated_at'],
  attachments: ['id', 'message_id', 'storage_path', 'file_name', 'mime_type', 'size_bytes', 'width', 'height', 'position', 'created_at'],
  import_map: ['source', 'kind', 'external_id', 'local_id', 'created_at'],
};

async function copy(table, rows) {
  const cols = COLS[table];
  let added = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map((r) => Object.fromEntries(cols.map((c) => [c, JSONB.has(c) ? sql.json(r[c] ?? {}) : (r[c] ?? null)])));
    const res = await sql`insert into ${sql(table)} ${sql(chunk, cols)} on conflict do nothing returning 1`;
    added += res.length;
  }
  console.log(`  ${table.padEnd(12)} ${String(added).padStart(6)} novos de ${rows.length}`);
}

try {
  console.log(`Copiando ${ROOT} → Postgres…`);
  // O perfil principal local passa a ser o perfil principal do banco
  const [dbOwner] = await sql`select id from identities where is_owner limit 1`;
  const identities = read('identities');
  const localOwner = identities.find((i) => i.is_owner);
  const ownerMap = (id) => (dbOwner && localOwner && id === localOwner.id ? dbOwner.id : id);
  if (dbOwner && localOwner) {
    await sql`update identities set name = ${localOwner.name}, avatar_path = ${localOwner.avatar_path ?? null},
      description = ${localOwner.description ?? null}, color = ${localOwner.color ?? null} where id = ${dbOwner.id}`;
  }

  await copy('identities', identities.filter((i) => !(dbOwner && i.is_owner)));
  await copy('spaces', read('spaces'));
  await copy('categories', read('categories'));
  await copy('channels', read('channels'));
  const messages = read('messages').map((m) => ({ ...m, identity_id: m.identity_id ? ownerMap(m.identity_id) : null }));
  await copy('messages', messages);
  // Respostas depois que todas as mensagens existem
  let replies = 0;
  for (const m of messages.filter((x) => x.reply_to_id)) {
    const r = await sql`update messages set reply_to_id = ${m.reply_to_id} where id = ${m.id} and reply_to_id is null
      and exists (select 1 from messages where id = ${m.reply_to_id}) returning 1`;
    replies += r.length;
  }
  console.log(`  respostas     ${String(replies).padStart(6)} ligadas`);
  await copy('attachments', read('attachments'));
  await copy('import_map', read('import_map').map((r) => ({ ...r, local_id: r.kind === 'identity' ? ownerMap(r.local_id) : r.local_id })));

  // Arquivos (anexos, avatares, ícones) usados pelos registros
  const paths = new Set([
    ...read('attachments').map((a) => a.storage_path),
    ...identities.map((i) => i.avatar_path).filter(Boolean),
    ...read('spaces').map((s) => s.icon_path).filter(Boolean),
  ]);
  const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', mp4: 'video/mp4', txt: 'text/plain' };
  const att = new Map(read('attachments').map((a) => [a.storage_path, a.mime_type]));
  let files = 0, missing = 0, bytes = 0;
  for (const p of paths) {
    const full = path.join(ROOT, 'files', p);
    if (!existsSync(full)) { missing++; continue; }
    const data = readFileSync(full);
    const type = att.get(p) ?? TYPES[p.split('.').pop().toLowerCase()] ?? 'application/octet-stream';
    const r = await sql`insert into files (path, content_type, size_bytes, data) values (${p}, ${type}, ${data.length}, ${data})
      on conflict (path) do nothing returning 1`;
    if (r.length) { files++; bytes += data.length; }
  }
  console.log(`  arquivos      ${String(files).padStart(6)} novos (${(bytes / 1048576).toFixed(1)} MB)${missing ? ` · ${missing} ausentes na pasta` : ''}`);

  const [c] = await sql`select (select count(*) from spaces)::int s, (select count(*) from messages)::int m, (select count(*) from files)::int f`;
  console.log(`✓ Concluído. No banco agora: ${c.s} espaços, ${c.m} mensagens, ${c.f} arquivos.`);
} catch (e) {
  console.error('✗ Falha:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
