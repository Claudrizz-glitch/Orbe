import 'server-only';
import { store } from './store';
import { nextPosition } from './workspace';
import type { Message } from '../types';

/**
 * Registro de alterações (LOG) — no mesmo formato da Loritta.
 * Fica num espaço próprio ("LOG" › #log), separado dos servidores: excluir um
 * espaço não apaga o histórico. Mensagens e anexos excluídos são guardados aqui
 * (os arquivos não são apagados), para poderem ser recuperados.
 */

// Cores no padrão da Loritta (decimal)
export const COLORS = {
  delete: 0xdd0000, // vermelho — exclusões
  edit: 0xeef000,   // amarelo — edições
  move: 0x3b82f6,   // azul — movimentações
  info: 0xa99cff,   // lilás — demais alterações
};

const K_CHANNEL = 'log.channel_id';

async function getSetting(key: string): Promise<string | null> {
  const [r] = await store().select<{ value: { id?: string } }>('settings', { cols: 'value', eq: { key } });
  return r?.value?.id ?? null;
}
async function setSetting(key: string, id: string) {
  await store().remove('settings', { eq: { key } });
  await store().insert('settings', [{ key, value: { id } }]);
}

/** Canal #log — criado na primeira vez. */
export async function logTarget(): Promise<{ channelId: string }> {
  const s = store();
  let channelId = await getSetting(K_CHANNEL);
  if (!channelId || !(await s.count('channels', { eq: { id: channelId } }))) {
    let [space] = await s.select<{ id: string }>('spaces', { cols: 'id', eq: { name: 'LOG' }, limit: 1 });
    if (!space) {
      [space] = await s.insert<{ id: string }>('spaces', [{ name: 'LOG', icon: '📜', color: '#f27a8f', position: await nextPosition('spaces') }], { cols: 'id' });
    }
    const [ch] = await s.insert<{ id: string }>('channels', [{
      space_id: space.id, name: 'log', sort_mode: 'chronological',
      topic: 'Registro de alterações e exclusões do ORBE e histórico da Loritta. Use para recuperar o que foi apagado.',
      position: await nextPosition('channels', { space_id: space.id, category_id: null }),
    }], { cols: 'id' });
    channelId = ch.id;
    await setSetting(K_CHANNEL, channelId);
  }
  return { channelId };
}

export async function isLogChannel(channelId: string) {
  return (await getSetting(K_CHANNEL)) === channelId;
}

/** O espaço que contém o #log (protegido contra exclusão). */
export async function isLogSpace(spaceId: string) {
  const ch = await getSetting(K_CHANNEL);
  if (!ch) return false;
  const [c] = await store().select<{ space_id: string }>('channels', { cols: 'space_id', eq: { id: ch } });
  return c?.space_id === spaceId;
}

/** "#canal (Espaço / Categoria)" */
export async function describeChannel(channelId: string | null): Promise<string> {
  if (!channelId) return '(desconhecido)';
  const s = store();
  const [c] = await s.select<{ name: string; space_id: string; category_id: string | null }>('channels', { cols: 'name, space_id, category_id', eq: { id: channelId } });
  if (!c) return '(canal excluído)';
  const [sp] = await s.select<{ name: string }>('spaces', { cols: 'name', eq: { id: c.space_id } });
  // caminho da categoria, incluindo as categorias-mãe ("Mãe › Subcategoria")
  const names: string[] = [];
  for (let id = c.category_id, n = 0; id && n < 8; n++) {
    const [cat] = await s.select<{ name: string; parent_id: string | null }>('categories', { cols: 'name, parent_id', eq: { id } });
    if (!cat) break;
    names.unshift(cat.name);
    id = cat.parent_id;
  }
  return `#${c.name} (${[sp?.name, names.join(' › ')].filter(Boolean).join(' / ')})`;
}

export async function identityName(id: string | null): Promise<string> {
  if (!id) return 'Sem autor';
  const [i] = await store().select<{ name: string }>('identities', { cols: 'name', eq: { id } });
  return i?.name ?? 'Identidade excluída';
}

const fmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo' });
export const when = (iso: string) => fmt.format(new Date(iso));

/** Texto dentro de bloco de código, sem quebrar o bloco. */
export const block = (t: string) => '```' + (t || ' ').replace(/```/g, "'''").slice(0, 3800) + '```';

export interface AuditEntry {
  title: string;              // ex.: "Mensagem de texto deletada"
  color: number;
  author: string;             // quem/qual identidade era o autor do conteúdo
  fields: { label: string; value: string }[];
  footer: string;
  /** anexos (ids) que passam a pertencer ao registro (não são apagados) */
  attachmentIds?: string[];
  /** referência técnica guardada em extra.log */
  ref?: Record<string, unknown>;
}

/** Grava uma entrada no #log. Falhas aqui nunca impedem a operação original. */
export async function audit(e: AuditEntry): Promise<string | null> {
  try {
    const s = store();
    const { channelId } = await logTarget();
    const description = `📝 **${e.title}**\n\n${e.fields.map((f) => `**${f.label}:** ${f.value}`).join('\n\n')}`;
    const [row] = await s.insert<{ id: string }>('messages', [{
      channel_id: channelId, identity_id: null, content: '',
      display_at: new Date().toISOString(), position: Date.now() / 1000,
      extra: { system: true, embeds: [{ color: e.color, author: e.author, description: description.slice(0, 12000), footer: e.footer }], log: { at: new Date().toISOString(), ...(e.ref ?? {}) } },
    }], { cols: 'id' });
    if (e.attachmentIds?.length) {
      await s.update('attachments', { in: { id: e.attachmentIds } }, { message_id: row.id }, 'id');
    }
    return row.id;
  } catch (err) {
    console.error('[ORBE LOG] falha ao registrar', err);
    return null;
  }
}

/**
 * Antes de excluir canais (ou uma categoria/espaço inteiro): gera a transcrição
 * completa em .txt, anexa ao registro e transfere todos os anexos para ele.
 */
export async function archiveChannels(channelIds: string[], title: string, extraFields: { label: string; value: string }[] = []) {
  try {
    const s = store();
    if (!channelIds.length) return null;
    const lines: string[] = [];
    let total = 0;
    const attIds: string[] = [];
    const idnCache = new Map<string, string>();
    const nameOf = async (id: string | null) => {
      if (!id) return 'Sem autor';
      if (!idnCache.has(id)) idnCache.set(id, await identityName(id));
      return idnCache.get(id)!;
    };
    for (const cid of channelIds) {
      const where = await describeChannel(cid);
      const msgs = await s.select<Message>('messages', { cols: 'id, identity_id, content, display_at, position', eq: { channel_id: cid }, order: [{ col: 'position' }] });
      lines.push(`════════ ${where} — ${msgs.length} mensagens ════════`, '');
      const ids = msgs.map((m) => m.id);
      const atts = new Map<string, string[]>();
      for (let i = 0; i < ids.length; i += 500) {
        for (const a of await s.select<{ id: string; message_id: string; file_name: string }>('attachments', { cols: 'id, message_id, file_name', in: { message_id: ids.slice(i, i + 500) } })) {
          attIds.push(a.id);
          atts.set(a.message_id, [...(atts.get(a.message_id) ?? []), a.file_name]);
        }
      }
      for (const m of msgs) {
        lines.push(`[${when(m.display_at)}] ${await nameOf(m.identity_id)}:`);
        if (m.content) lines.push(m.content);
        if (atts.get(m.id)) lines.push(`(anexos: ${atts.get(m.id)!.join(', ')})`);
        lines.push('');
      }
      total += msgs.length;
    }
    const names = await Promise.all(channelIds.map((c) => describeChannel(c)));
    const entryId = await audit({
      title, color: COLORS.delete, author: 'ORBE',
      fields: [
        { label: channelIds.length === 1 ? 'Canal' : 'Canais', value: names.join(', ') },
        { label: 'Mensagens arquivadas', value: `${total} (transcrição completa no arquivo anexo)` },
        ...(attIds.length ? [{ label: 'Anexos preservados', value: String(attIds.length) }] : []),
        ...extraFields,
      ],
      footer: `Registrado em ${when(new Date().toISOString())}`,
      attachmentIds: attIds,
      ref: { event: 'channels.archive', channel_ids: channelIds },
    });
    if (entryId) {
      const text = new TextEncoder().encode(lines.join('\n'));
      const path = `attachments/${entryId}/${crypto.randomUUID()}-transcricao.txt`;
      await s.putFile(path, text, 'text/plain; charset=utf-8');
      await s.insert('attachments', [{ message_id: entryId, storage_path: path, file_name: 'transcricao.txt', mime_type: 'text/plain', size_bytes: text.byteLength, position: -1 }]);
    }
    return entryId;
  } catch (err) {
    console.error('[ORBE LOG] falha ao arquivar canais', err);
    return null;
  }
}

/** Entrada padrão para uma mensagem excluída (texto completo + anexos preservados). */
export async function auditMessageDeleted(m: Message, attachmentIds: string[], fileNames: string[]) {
  return audit({
    title: 'Mensagem de texto deletada',
    color: COLORS.delete,
    author: await identityName(m.identity_id),
    fields: [
      { label: 'Canal de texto', value: await describeChannel(m.channel_id) },
      { label: 'Mensagem', value: `\n${block(m.content)}` },
      ...(fileNames.length ? [{ label: 'Anexos preservados', value: fileNames.join(', ') }] : []),
    ],
    footer: `Data exibida: ${when(m.display_at)} · Criada: ${when(m.created_at)} · ID da mensagem: ${m.id}`,
    attachmentIds,
    ref: { event: 'message.delete', message_id: m.id, channel_id: m.channel_id, identity_id: m.identity_id, display_at: m.display_at, content: m.content },
  });
}

// ── Autores do Discord cujas mensagens vão direto ao #log (bots de registro) ──
const K_AUTHORS = 'log.discord_authors';

/** IDs do Discord (autores) cujas mensagens viram registros soltos no #log. */
export async function logAuthors(): Promise<Set<string>> {
  const s = store();
  const [r] = await s.select<{ value: { ids?: string[] } }>('settings', { cols: 'value', eq: { key: K_AUTHORS } });
  if (r?.value?.ids) return new Set(r.value.ids);
  // Primeira vez: deduz dos registros já levados ao #log
  const logId = await getSetting(K_CHANNEL);
  const ids = new Set<string>();
  if (logId) {
    for (const m of await s.select<{ extra: Message['extra'] & { collected_from?: string; discord?: { author?: string } } }>('messages', { cols: 'extra', eq: { channel_id: logId } })) {
      if (m.extra?.collected_from && m.extra.discord?.author) ids.add(m.extra.discord.author);
    }
  }
  if (ids.size) await saveLogAuthors(ids);
  return ids;
}
async function saveLogAuthors(ids: Set<string>) {
  await store().remove('settings', { eq: { key: K_AUTHORS } });
  await store().insert('settings', [{ key: K_AUTHORS, value: { ids: [...ids] } }]);
}
export async function addLogAuthors(add: string[]) {
  if (!add.length) return;
  const cur = await logAuthors();
  add.forEach((x) => cur.add(x));
  await saveLogAuthors(cur);
}

/** Troca marcações do Discord (<#canal>, <@usuário>) por nomes do ORBE. */
export async function discordReadable(): Promise<(t: string | undefined) => string | undefined> {
  const s = store();
  const chanMap = new Map<string, string>();
  for (const r of await s.select<{ external_id: string; local_id: string }>('import_map', { eq: { source: 'discord', kind: 'channel' } })) {
    chanMap.set(r.external_id, await describeChannel(r.local_id));
  }
  const names = new Map((await s.select<{ id: string; name: string }>('identities', { cols: 'id, name' })).map((i) => [i.id, i.name]));
  const userMap = new Map<string, string>();
  for (const r of await s.select<{ external_id: string; local_id: string }>('import_map', { eq: { source: 'discord', kind: 'identity' } })) {
    if (names.has(r.local_id)) userMap.set(r.external_id, names.get(r.local_id)!);
  }
  const owner = (await s.select<{ name: string }>('identities', { cols: 'name', eq: { is_owner: true }, limit: 1 }))[0];
  return (t) => t
    ?.replace(/<#(\d+)>/g, (_, id: string) => chanMap.get(id) ?? `#canal fora do ORBE (ID ${id})`)
    .replace(/<@!?(\d+)>/g, (_, id: string) => `@${userMap.get(id) ?? owner?.name ?? 'usuário'}`);
}
