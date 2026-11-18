import 'server-only';
import { randomUUID } from 'node:crypto';
import { store, persist } from '../store';
import { nextPosition } from '../workspace';
import { CH, DiscordError, cdn, dget, download, type DAttachment, type DChannel, type DGuild, type DMessage } from './client';
import { convertContent, convertEmbeds, safeFileName } from './convert';
import type { Embed, ImportJob, ImportStats } from '@/lib/types';
import { describeChannel, discordReadable, logAuthors, logTarget } from '../audit';

const SOURCE = 'discord';
/** Tipos de mensagem com conteúdo do usuário (padrão, resposta, comandos). */
const CONTENT_TYPES = new Set([0, 19, 20, 23]);
const TEXT_TYPES = new Set([CH.TEXT, CH.ANNOUNCEMENT, CH.VOICE, CH.STAGE]);
const THREAD_TYPES = new Set([CH.ANNOUNCEMENT_THREAD, CH.PUBLIC_THREAD, CH.PRIVATE_THREAD]);
const PALETTE = ['#a99cff', '#6ee7d8', '#f0c36b', '#f27a8f', '#7cb8ff', '#b6e36f', '#e48cf2', '#f5a06b'];

interface ChanState { did: string; lid: string; name: string; last: string | null; pos: number; done: boolean; count: number }
interface PendingAtt { mid: string; dmsg: string; dchan: string; att: DAttachment; pos: number }
interface JobState {
  phase: 'structure' | 'messages' | 'done';
  idx: number;
  channels: ChanState[];
  names: Record<string, string>;
  roles: Record<string, string>;
  pending: PendingAtt[];
  owner_did: string | null;
  lock_until?: number;
}
export type JobStats = ImportStats;
interface LogLine { t: string; level: 'info' | 'warn'; msg: string }
interface JobRow {
  id: string; source: string; external_id: string; name: string; space_id: string | null;
  status: 'running' | 'done' | 'error' | 'cancelled';
  options: { owner_is_me?: boolean; attachments?: boolean };
  state: JobState; stats: JobStats; log: LogLine[]; error: string | null;
  created_at: string; updated_at: string; finished_at: string | null;
}

export type PublicJob = ImportJob;

const emptyStats = (): JobStats => ({ categories: 0, channels: 0, messages: 0, attachments: 0, identities: 0, skipped_channels: 0, skipped_messages: 0, failed_attachments: 0, bytes: 0 });

export function toPublic(j: JobRow): PublicJob {
  const st = j.state;
  const cur = st.channels?.[st.idx];
  return {
    id: j.id, name: j.name, guild_id: j.external_id, status: j.status, space_id: j.space_id,
    stats: j.stats, log: j.log.slice(-40), error: j.error,
    progress: {
      phase: st.phase ?? 'structure',
      channel: Math.min(st.idx ?? 0, st.channels?.length ?? 0),
      total: st.channels?.length ?? 0,
      current: st.phase === 'messages' ? cur?.name ?? null : null,
      pending_files: st.pending?.length ?? 0,
    },
    created_at: j.created_at, updated_at: j.updated_at,
  };
}

function log(j: JobRow, msg: string, level: LogLine['level'] = 'info') {
  j.log.push({ t: new Date().toISOString(), level, msg });
  if (j.log.length > 120) j.log.splice(0, j.log.length - 120);
}

async function saveJob(j: JobRow) {
  await store().update('import_jobs', { eq: { id: j.id } }, {
    status: j.status, state: j.state, stats: j.stats, log: j.log, error: j.error,
    space_id: j.space_id, finished_at: j.finished_at,
  }, 'id');
  await persist();
}

export async function getJob(id: string): Promise<JobRow | null> {
  const [j] = await store().select<JobRow>('import_jobs', { eq: { id } });
  return j ?? null;
}

export async function listJobs(): Promise<PublicJob[]> {
  const rows = await store().select<JobRow>('import_jobs', { eq: { source: SOURCE }, order: [{ col: 'created_at', asc: false }], limit: 10 });
  return rows.map(toPublic);
}

/** Cria um trabalho de importação (ou devolve o que já está em andamento para o servidor). */
export async function startImport(guildId: string, opts: { owner_is_me: boolean; attachments: boolean }): Promise<JobRow> {
  const [running] = await store().select<JobRow>('import_jobs', { eq: { source: SOURCE, external_id: guildId, status: 'running' }, limit: 1 });
  if (running) return running;
  const guild = await dget<DGuild>(`/guilds/${guildId}`);
  const state: JobState = { phase: 'structure', idx: 0, channels: [], names: {}, roles: {}, pending: [], owner_did: opts.owner_is_me ? guild.owner_id ?? null : null };
  const [row] = await store().insert<JobRow>('import_jobs', [{
    source: SOURCE, external_id: guildId, name: guild.name, status: 'running',
    options: opts, state, stats: emptyStats(), log: [{ t: new Date().toISOString(), level: 'info', msg: `Importação de “${guild.name}” iniciada.` }],
  }]);
  await persist();
  return row;
}

export async function setJobStatus(id: string, action: 'resume' | 'cancel'): Promise<JobRow | null> {
  const j = await getJob(id);
  if (!j) return null;
  if (action === 'cancel' && j.status === 'running') { j.status = 'cancelled'; log(j, 'Importação cancelada. O que já foi importado foi mantido.'); }
  if (action === 'resume' && (j.status === 'error' || j.status === 'cancelled')) { j.status = 'running'; j.error = null; log(j, 'Importação retomada.'); }
  await saveJob(j);
  return j;
}

// ── Mapa origem → ORBE ─────────────────────────────────────
type Kind = 'space' | 'category' | 'channel' | 'identity';
const LOCAL_TABLE: Record<Kind, 'spaces' | 'categories' | 'channels' | 'identities'> = { space: 'spaces', category: 'categories', channel: 'channels', identity: 'identities' };

/** Busca vários mapeamentos de uma vez, ignorando os que apontam para itens já excluídos no ORBE. */
async function mapGetMany(kind: Kind, ext: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ext.length) return out;
  const rows = await store().select<{ external_id: string; local_id: string }>('import_map', { eq: { source: SOURCE, kind }, in: { external_id: ext } });
  if (!rows.length) return out;
  const alive = new Set((await store().select<{ id: string }>(LOCAL_TABLE[kind], { cols: 'id', in: { id: rows.map((r) => r.local_id) } })).map((r) => r.id));
  for (const r of rows) if (alive.has(r.local_id)) out.set(r.external_id, r.local_id);
  return out;
}
async function mapSet(kind: Kind, ext: string, local: string) {
  await store().remove('import_map', { eq: { source: SOURCE, kind, external_id: ext } });
  await store().insert('import_map', [{ source: SOURCE, kind, external_id: ext, local_id: local }]);
}

async function saveRemoteFile(url: string, path: string): Promise<boolean> {
  try {
    const f = await download(url);
    if (!f) return false;
    await store().putFile(path, f.data, f.type);
    return true;
  } catch { return false; }
}

// ── Etapa 1: estrutura (espaço, categorias, canais) ────────
async function importStructure(j: JobRow) {
  const s = store();
  const gid = j.external_id;
  const guild = await dget<DGuild>(`/guilds/${gid}`);
  j.state.roles = Object.fromEntries((guild.roles ?? []).map((r) => [r.id, r.name === '@everyone' ? 'everyone' : r.name]));

  // Espaço
  let spaceId = (await mapGetMany('space', [gid])).get(gid);
  if (!spaceId) {
    const color = PALETTE[Number(BigInt(gid) % BigInt(PALETTE.length))];
    const [sp] = await s.insert<{ id: string }>('spaces', [{ name: guild.name.slice(0, 100), color, position: await nextPosition('spaces') }], { cols: 'id' });
    spaceId = sp.id;
    await mapSet('space', gid, spaceId);
    log(j, `Espaço “${guild.name}” criado.`);
  } else {
    log(j, `Espaço “${guild.name}” já existia — continuando de onde parou.`);
  }
  j.space_id = spaceId;
  if (guild.icon) {
    const p = `spaces/${spaceId}/icon.png`;
    if (await saveRemoteFile(cdn.guildIcon(gid, guild.icon), p)) await s.update('spaces', { eq: { id: spaceId } }, { icon_path: p }, 'id');
  }

  // Canais e tópicos
  const all = await dget<DChannel[]>(`/guilds/${gid}/channels`);
  for (const c of all) j.state.names[c.id] = c.name;
  const threads: DChannel[] = [];
  try {
    const act = await dget<{ threads: DChannel[] }>(`/guilds/${gid}/threads/active`);
    threads.push(...act.threads);
  } catch (e) { if (!(e instanceof DiscordError && e.status === 403)) throw e; }
  for (const parent of all.filter((c) => [CH.TEXT, CH.ANNOUNCEMENT, CH.FORUM, CH.MEDIA].includes(c.type))) {
    for (const kind of ['public', 'private'] as const) {
      let before: string | undefined;
      for (let page = 0; page < 50; page++) {
        try {
          const r = await dget<{ threads: (DChannel & { thread_metadata?: { archive_timestamp: string } })[]; has_more: boolean }>(
            `/channels/${parent.id}/threads/archived/${kind}?limit=100${before ? `&before=${encodeURIComponent(before)}` : ''}`);
          threads.push(...r.threads);
          if (!r.has_more || !r.threads.length) break;
          before = r.threads[r.threads.length - 1].thread_metadata?.archive_timestamp;
          if (!before) break;
        } catch (e) {
          if (e instanceof DiscordError && (e.status === 403 || e.status === 404)) break;
          throw e;
        }
      }
    }
  }
  const uniqThreads = [...new Map(threads.map((t) => [t.id, t])).values()];
  for (const t of uniqThreads) j.state.names[t.id] = t.name;

  // Categorias
  const cats = all.filter((c) => c.type === CH.CATEGORY).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const catMap = await mapGetMany('category', cats.map((c) => c.id));
  for (const c of cats) {
    if (catMap.has(c.id)) continue;
    const [row] = await s.insert<{ id: string }>('categories', [{ space_id: spaceId, name: c.name.slice(0, 100), position: await nextPosition('categories', { space_id: spaceId }) }], { cols: 'id' });
    catMap.set(c.id, row.id);
    await mapSet('category', c.id, row.id);
    j.stats.categories++;
  }

  // Ordem: sem categoria primeiro, depois cada categoria; tópicos logo após o canal-pai
  const byParent = (pid: string | null) => all
    .filter((c) => (c.parent_id ?? null) === pid && (TEXT_TYPES.has(c.type) || c.type === CH.FORUM || c.type === CH.MEDIA))
    .sort((a, b) => (Number(a.type === CH.VOICE || a.type === CH.STAGE) - Number(b.type === CH.VOICE || b.type === CH.STAGE)) || (a.position ?? 0) - (b.position ?? 0));
  const ordered: { ch: DChannel; catDid: string | null; label: string; icon: string | null }[] = [];
  for (const pid of [null, ...cats.map((c) => c.id)]) {
    for (const c of byParent(pid)) {
      const isForum = c.type === CH.FORUM || c.type === CH.MEDIA;
      if (!isForum) ordered.push({ ch: c, catDid: pid, label: c.name, icon: c.type === CH.ANNOUNCEMENT ? '📢' : c.type === CH.VOICE || c.type === CH.STAGE ? '🔊' : null });
      for (const t of uniqThreads.filter((t) => t.parent_id === c.id && THREAD_TYPES.has(t.type))) {
        ordered.push({ ch: t, catDid: pid, label: `${c.name} › ${t.name}`, icon: isForum ? '🗂️' : '🧵' });
      }
    }
  }

  const chMap = await mapGetMany('channel', ordered.map((o) => o.ch.id));
  const chans: ChanState[] = [];
  for (const o of ordered) {
    let lid = chMap.get(o.ch.id);
    let last: string | null = null;
    let pos = 0;
    if (!lid) {
      const category_id = o.catDid ? catMap.get(o.catDid) ?? null : null;
      const [row] = await s.insert<{ id: string }>('channels', [{
        space_id: spaceId, category_id, name: o.label.slice(0, 100), icon: o.icon,
        topic: o.ch.topic?.slice(0, 1000) ?? null,
        position: await nextPosition('channels', { space_id: spaceId, category_id }),
      }], { cols: 'id' });
      lid = row.id;
      await mapSet('channel', o.ch.id, lid);
      j.stats.channels++;
    } else {
      // Retoma depois da última mensagem já importada neste canal
      const [lastMsg] = await s.select<{ position: number; extra: { discord?: { id?: string } } }>('messages', {
        cols: 'position, extra', eq: { channel_id: lid }, order: [{ col: 'position', asc: false }], limit: 1,
      });
      if (lastMsg) { last = lastMsg.extra?.discord?.id ?? null; pos = Number(lastMsg.position) + 1; }
    }
    chans.push({ did: o.ch.id, lid, name: o.label, last, pos, done: false, count: 0 });
  }
  j.state.channels = chans;
  j.state.phase = 'messages';
  j.state.idx = 0;
  log(j, `Estrutura pronta: ${cats.length} categorias, ${chans.length} canais (incluindo tópicos).`);
}

// ── Identidades (autores) ──────────────────────────────────
function authorKey(m: DMessage) {
  // Webhooks (ex.: Tupperbox/PluralKit) usam o mesmo ID para vários personagens
  return m.webhook_id ? `webhook:${m.webhook_id}:${m.author.username}` : m.author.id;
}

async function ensureIdentities(j: JobRow, msgs: DMessage[], ownerId: string | null): Promise<Map<string, string>> {
  const s = store();
  const keys = [...new Set(msgs.map(authorKey))];
  const map = await mapGetMany('identity', keys);
  for (const m of msgs) {
    const key = authorKey(m);
    if (map.has(key)) continue;
    if (ownerId && !m.webhook_id && m.author.id === j.state.owner_did) { map.set(key, ownerId); continue; }
    const name = (m.author.global_name || m.author.username || 'Desconhecido').slice(0, 100);
    const [idn] = await s.insert<{ id: string }>('identities', [{
      name,
      description: m.webhook_id ? 'Importado do Discord (webhook/personagem)' : `Importado do Discord (@${m.author.username})`,
      position: await nextPosition('identities'),
    }], { cols: 'id' });
    const url = m.author.avatar ? cdn.avatar(m.author.id, m.author.avatar) : (m.webhook_id ? null : cdn.defaultAvatar(m.author.id));
    if (url) {
      const p = `avatars/${idn.id}.png`;
      if (await saveRemoteFile(url, p)) await s.update('identities', { eq: { id: idn.id } }, { avatar_path: p }, 'id');
    }
    await mapSet('identity', key, idn.id);
    map.set(key, idn.id);
    j.stats.identities++;
  }
  return map;
}

// ── Etapa 2: mensagens ─────────────────────────────────────
interface LogCtx { authors: Set<string>; channelId?: string; readable?: (t: string | undefined) => string | undefined }

async function importBatch(j: JobRow, ch: ChanState, ownerId: string | null, lg: LogCtx) {
  const s = store();
  let batch: DMessage[];
  try {
    batch = await dget<DMessage[]>(`/channels/${ch.did}/messages?limit=100&after=${ch.last ?? '0'}`);
  } catch (e) {
    if (e instanceof DiscordError && (e.status === 403 || e.status === 404)) {
      log(j, `Sem acesso a #${ch.name} — dê ao bot permissão de ver o canal e ler o histórico.`, 'warn');
      j.stats.skipped_channels++;
      ch.done = true;
      return;
    }
    throw e;
  }
  batch.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  if (!batch.length) { ch.done = true; return; }

  const msgs = batch.filter((m) => CONTENT_TYPES.has(m.type));
  j.stats.skipped_messages += batch.length - msgs.length;

  if (msgs.length) {
    // Autores de registro (ex.: Loritta) não ganham perfil: viram registros soltos no #log
    const toLog = (m: DMessage) => !m.webhook_id && lg.authors.has(m.author.id);
    const authors = await ensureIdentities(j, msgs.filter((m) => !toLog(m)), ownerId);
    if (msgs.some(toLog) && !lg.channelId) {
      lg.channelId = (await logTarget()).channelId;
      lg.readable = await discordReadable();
    }
    const origin = msgs.some(toLog) ? await describeChannel(ch.lid) : '';

    // Respostas: mensagens já importadas + as deste lote
    const refIds = [...new Set(msgs.map((m) => m.message_reference?.message_id).filter((x): x is string => !!x))];
    const refRows = refIds.length
      ? await s.select<{ id: string; source_ref: string }>('messages', { cols: 'id, source_ref', in: { source_ref: refIds.map((r) => `discord:${r}`) } })
      : [];
    const refMap = new Map(refRows.map((r) => [r.source_ref.slice(8), r.id]));
    // Mensagens deste lote que já existem (etapa anterior interrompida após gravar)
    const existing = new Map((await s.select<{ id: string; source_ref: string }>('messages', {
      cols: 'id, source_ref', in: { source_ref: msgs.map((m) => `discord:${m.id}`) },
    })).map((r) => [r.source_ref.slice(8), r.id]));
    const ids = new Map(msgs.map((m) => [m.id, existing.get(m.id) ?? randomUUID()]));

    const lk = { channels: j.state.names, roles: j.state.roles };
    const rows = msgs.filter((m) => !existing.has(m.id)).map((m) => {
      let content = convertContent(m, lk);
      const embeds = convertEmbeds(m.embeds);
      const stickers = (m.sticker_items ?? []).map((x) => x.name);
      if (!content && !m.attachments?.length && !embeds.length && stickers.length) content = `*[figurinha: ${stickers.join(', ')}]*`;
      const refId = m.message_reference?.message_id;
      if (toLog(m)) {
        const r = lg.readable!;
        const logEmbeds: Embed[] = embeds.map((e) => ({
          ...e, description: r(e.description), title: r(e.title),
          footer: [e.footer, `Origem: ${origin} · registrado por ${m.author.global_name || m.author.username}`].filter(Boolean).join(' · '),
        }));
        return {
          id: ids.get(m.id), channel_id: lg.channelId!, identity_id: null, reply_to_id: null,
          content: (r(content) ?? '').slice(0, 200000), display_at: m.timestamp, edited_at: m.edited_timestamp, pinned_at: null,
          position: Date.parse(m.timestamp) / 1000, source_ref: `discord:${m.id}`,
          extra: { discord: { id: m.id, author: m.author.id }, embeds: logEmbeds, system: true, origin, collected_from: m.author.global_name || m.author.username },
        };
      }
      return {
        id: ids.get(m.id),
        channel_id: ch.lid,
        identity_id: authors.get(authorKey(m)) ?? null,
        reply_to_id: refId ? ids.get(refId) ?? refMap.get(refId) ?? null : null,
        content: content.slice(0, 200000),
        display_at: m.timestamp,
        edited_at: m.edited_timestamp,
        pinned_at: m.pinned ? m.timestamp : null,
        position: ch.pos++,
        source_ref: `discord:${m.id}`,
        extra: { discord: { id: m.id, author: m.author.id }, ...(embeds.length ? { embeds } : {}), ...(stickers.length ? { stickers } : {}) },
      };
    });
    const inserted = await s.insert<{ id: string; source_ref: string }>('messages', rows, { ignoreDuplicatesOn: 'source_ref', cols: 'id, source_ref' });
    const fresh = new Set(inserted.map((r) => r.source_ref));
    j.stats.messages += inserted.length;
    ch.count += inserted.length;

    if (j.options.attachments !== false) {
      for (const m of msgs) {
        if (!fresh.has(`discord:${m.id}`)) continue;
        (m.attachments ?? []).forEach((att, i) => j.state.pending.push({ mid: ids.get(m.id)!, dmsg: m.id, dchan: ch.did, att, pos: i }));
      }
    }
  }
  ch.last = batch[batch.length - 1].id;
  if (batch.length < 100) ch.done = true;
}

async function importAttachment(j: JobRow, p: PendingAtt) {
  const s = store();
  const path = `attachments/${p.mid}/${p.att.id}-${safeFileName(p.att.filename)}`;
  if (p.att.size > 50 * 1024 * 1024) {
    log(j, `Anexo “${p.att.filename}” ignorado (maior que 50 MB).`, 'warn');
    j.stats.failed_attachments++;
    return;
  }
  let f = await download(p.att.url).catch(() => null);
  if (!f) {
    // Links da CDN expiram: pede ao Discord uma URL nova
    try {
      const fresh = await dget<DMessage>(`/channels/${p.dchan}/messages/${p.dmsg}`);
      const a = fresh.attachments?.find((x) => x.id === p.att.id);
      if (a) f = await download(a.url).catch(() => null);
    } catch { /* mensagem apagada no Discord */ }
  }
  if (!f) {
    log(j, `Não foi possível baixar “${p.att.filename}”.`, 'warn');
    j.stats.failed_attachments++;
    return;
  }
  await s.putFile(path, f.data, p.att.content_type ?? f.type);
  await s.insert('attachments', [{
    message_id: p.mid, storage_path: path, file_name: p.att.filename.slice(0, 255),
    mime_type: p.att.content_type ?? f.type, size_bytes: f.data.byteLength,
    width: p.att.width ?? null, height: p.att.height ?? null, position: p.pos,
  }], { ignoreDuplicatesOn: 'storage_path' });
  j.stats.attachments++;
  j.stats.bytes += f.data.byteLength;
}

/**
 * Executa uma etapa curta (≈ budgetMs) e salva o progresso.
 * O navegador chama repetidamente até status ≠ running.
 */
export async function runStep(id: string, budgetMs = 20000): Promise<JobRow | null> {
  const j = await getJob(id);
  if (!j || j.status !== 'running') return j;
  if ((j.state.lock_until ?? 0) > Date.now()) return j; // outra aba já está processando
  const deadline = Date.now() + budgetMs;
  j.state.lock_until = deadline + 15000;
  await saveJob(j);

  const [owner] = await store().select<{ id: string }>('identities', { cols: 'id', eq: { is_owner: true }, limit: 1 });
  const ownerId = owner?.id ?? null;
  const lg: LogCtx = { authors: await logAuthors() };

  try {
    if (j.state.phase === 'structure') await importStructure(j);
    while (j.state.phase === 'messages' && Date.now() < deadline) {
      if (j.state.pending.length) {
        const chunk = j.state.pending.splice(0, 4);
        await Promise.all(chunk.map((p) => importAttachment(j, p)));
        continue;
      }
      const ch = j.state.channels[j.state.idx];
      if (!ch) {
        j.state.phase = 'done';
        break;
      }
      if (ch.done) {
        if (ch.count) log(j, `#${ch.name}: ${ch.count} mensagens.`);
        j.state.idx++;
        continue;
      }
      await importBatch(j, ch, ownerId, lg);
      await saveJob(j); // salva a cada lote: nada se perde se a conexão cair
    }
    if (j.state.phase === 'done') {
      j.status = 'done';
      j.finished_at = new Date().toISOString();
      log(j, `Concluído: ${j.stats.messages} mensagens, ${j.stats.attachments} anexos, ${j.stats.identities} identidades.`);
    }
  } catch (e) {
    const err = e as Error & { status?: number };
    j.status = 'error';
    j.error = err instanceof DiscordError && err.status === 401
      ? 'Token do bot inválido. Verifique DISCORD_BOT_TOKEN.'
      : `Falha: ${err.message}. Clique em “Continuar” para retomar de onde parou.`;
    log(j, j.error, 'warn');
  }
  j.state.lock_until = 0;
  await saveJob(j);
  return j;
}
