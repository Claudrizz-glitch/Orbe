import { json, protectedRoute } from '@/lib/server/api';
import { botToken, cdn, dget, DiscordError } from '@/lib/server/discord/client';
import { listJobs } from '@/lib/server/discord/importer';
import { store } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

const MESSAGE_CONTENT = 1 << 18;
const MESSAGE_CONTENT_LIMITED = 1 << 19;
// Ver canais (1024) + Ler histórico de mensagens (65536)
const READ_PERMS = 1024 + 65536;

/** Estado da integração: bot configurado?, intenção de conteúdo ativa?, servidores acessíveis. */
export const GET = protectedRoute(async () => {
  const jobs = await listJobs();
  if (!botToken()) return json({ configured: false, storage: store().kind, jobs });

  try {
    const [bot, app, guilds] = await Promise.all([
      dget<{ id: string; username: string }>('/users/@me'),
      dget<{ id: string; flags?: number }>('/oauth2/applications/@me'),
      dget<{ id: string; name: string; icon: string | null; owner?: boolean }[]>('/users/@me/guilds'),
    ]);
    const flags = app.flags ?? 0;
    const imported = await store().select<{ external_id: string; local_id: string }>('import_map', {
      eq: { source: 'discord', kind: 'space' }, in: { external_id: guilds.map((g) => g.id) },
    });
    const impMap = new Map(imported.map((r) => [r.external_id, r.local_id]));
    return json({
      configured: true,
      storage: store().kind,
      bot: { id: bot.id, name: bot.username },
      message_content: Boolean(flags & (MESSAGE_CONTENT | MESSAGE_CONTENT_LIMITED)),
      invite_url: `https://discord.com/oauth2/authorize?client_id=${app.id}&scope=bot&permissions=${READ_PERMS}`,
      invite_admin_url: `https://discord.com/oauth2/authorize?client_id=${app.id}&scope=bot&permissions=8`,
      guilds: guilds.map((g) => ({
        id: g.id, name: g.name,
        icon_url: g.icon ? cdn.guildIcon(g.id, g.icon) : null,
        space_id: impMap.get(g.id) ?? null,
      })),
      jobs,
    });
  } catch (e) {
    if (e instanceof DiscordError && e.status === 401) {
      return json({ configured: true, storage: store().kind, error: 'O token do bot foi recusado pelo Discord. Gere um novo em Bot → Reset Token.', jobs });
    }
    throw e;
  }
});
