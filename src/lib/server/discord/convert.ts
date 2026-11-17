import 'server-only';
import type { DEmbed, DMessage } from './client';
import type { Embed } from '@/lib/types';

export interface Lookups {
  channels: Record<string, string>;
  roles: Record<string, string>;
}

const TS_FMT: Record<string, Intl.DateTimeFormatOptions> = {
  t: { timeStyle: 'short' }, T: { timeStyle: 'medium' },
  d: { dateStyle: 'short' }, D: { dateStyle: 'long' },
  f: { dateStyle: 'long', timeStyle: 'short' }, F: { dateStyle: 'full', timeStyle: 'short' },
  R: { dateStyle: 'long', timeStyle: 'short' },
};

/**
 * Converte marcações próprias do Discord em texto legível, preservando a
 * formatação Markdown (negrito, itálico, sublinhado, citações, código…),
 * que o ORBE interpreta no mesmo dialeto.
 */
export function convertContent(m: DMessage, lk: Lookups): string {
  const users = new Map((m.mentions ?? []).map((u) => [u.id, u.global_name || u.username]));
  return (m.content ?? '')
    .replace(/<@!?(\d+)>/g, (_, id) => `@${users.get(id) ?? 'usuário'}`)
    .replace(/<@&(\d+)>/g, (_, id) => `@${lk.roles[id] ?? 'cargo'}`)
    .replace(/<#(\d+)>/g, (_, id) => `#${lk.channels[id] ?? 'canal'}`)
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/<t:(-?\d+)(?::([tTdDfFR]))?>/g, (_, s, style) =>
      new Date(Number(s) * 1000).toLocaleString('pt-BR', { ...(TS_FMT[style ?? 'f']), timeZone: 'America/Sao_Paulo' }));
}

export function convertEmbeds(embeds: DEmbed[] | undefined): Embed[] {
  return (embeds ?? [])
    .map((e) => ({
      title: e.title, description: e.description, url: e.url, color: e.color,
      author: e.author?.name, footer: e.footer?.text,
    }))
    .filter((e) => e.title || e.description || e.author);
}

export function safeFileName(name: string) {
  const clean = name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(-120);
  return clean || 'arquivo';
}
