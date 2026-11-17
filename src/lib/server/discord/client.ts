import 'server-only';

/**
 * Cliente mínimo da API oficial do Discord (v10), autenticado como BOT.
 * Nunca usa token de usuário (self-bot viola os Termos do Discord).
 */
// DISCORD_API_BASE existe apenas para testes automatizados com um servidor simulado.
const API = process.env.DISCORD_API_BASE?.trim() || 'https://discord.com/api/v10';
const UA = 'DiscordBot (https://github.com/Claudrizz-glitch/Orbe, 1.0) ORBE-import';
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export class DiscordError extends Error {
  constructor(public status: number, message: string, public code?: number) { super(message); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function botToken(): string | null {
  return process.env.DISCORD_BOT_TOKEN?.trim() || null;
}

export async function dget<T>(path: string): Promise<T> {
  const token = botToken();
  if (!token) throw new DiscordError(401, 'DISCORD_BOT_TOKEN não configurado.');
  for (let attempt = 0; attempt < 6; attempt++) {
    let res: Response;
    try {
      res = await fetch(API + path, { headers: { Authorization: `Bot ${token}`, 'User-Agent': UA }, cache: 'no-store' });
    } catch {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (res.status === 429) {
      const b = (await res.json().catch(() => ({}))) as { retry_after?: number };
      await sleep((b.retry_after ?? 1) * 1000 + 150);
      continue;
    }
    if (res.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { message?: string; code?: number };
      throw new DiscordError(res.status, b.message ?? `HTTP ${res.status}`, b.code);
    }
    const data = (await res.json()) as T;
    // Respeita o balde de limite antes da próxima chamada
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      await sleep(parseFloat(res.headers.get('x-ratelimit-reset-after') ?? '1') * 1000 + 50);
    }
    return data;
  }
  throw new DiscordError(503, 'O Discord não respondeu após várias tentativas.');
}

/** Baixa um arquivo da CDN do Discord. Retorna null se expirou/não existe. */
export async function download(url: string): Promise<{ data: Uint8Array; type: string } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try { res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' }); }
    catch { await sleep(800 * (attempt + 1)); continue; }
    if (res.status === 404 || res.status === 403 || res.status === 410) return null;
    if (res.status === 429 || res.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_FILE_BYTES) throw new DiscordError(413, 'Arquivo maior que 50 MB.');
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_FILE_BYTES) throw new DiscordError(413, 'Arquivo maior que 50 MB.');
    return { data: buf, type: res.headers.get('content-type') ?? 'application/octet-stream' };
  }
  return null;
}

export const cdn = {
  guildIcon: (id: string, hash: string) => `https://cdn.discordapp.com/icons/${id}/${hash}.png?size=256`,
  avatar: (userId: string, hash: string) => `https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=128`,
  defaultAvatar: (userId: string) => `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(userId) >> BigInt(22)) % BigInt(6))}.png`,
};

// ── Tipos (somente os campos usados) ─────────────────────────
export interface DUser { id: string; username: string; global_name?: string | null; avatar?: string | null; bot?: boolean }
export interface DGuild { id: string; name: string; icon: string | null; owner_id?: string; roles?: { id: string; name: string }[] }
export interface DChannel { id: string; type: number; name: string; parent_id?: string | null; position?: number; topic?: string | null; guild_id?: string }
export interface DAttachment { id: string; filename: string; size: number; url: string; content_type?: string; width?: number | null; height?: number | null }
export interface DEmbed { title?: string; description?: string; url?: string; color?: number; author?: { name?: string }; footer?: { text?: string } }
export interface DMessage {
  id: string; type: number; content: string; timestamp: string; edited_timestamp: string | null; pinned: boolean;
  author: DUser; webhook_id?: string; mentions?: DUser[]; attachments?: DAttachment[]; embeds?: DEmbed[];
  sticker_items?: { name: string }[]; message_reference?: { message_id?: string; channel_id?: string };
}

export const CH = { TEXT: 0, VOICE: 2, CATEGORY: 4, ANNOUNCEMENT: 5, ANNOUNCEMENT_THREAD: 10, PUBLIC_THREAD: 11, PRIVATE_THREAD: 12, STAGE: 13, FORUM: 15, MEDIA: 16 };
