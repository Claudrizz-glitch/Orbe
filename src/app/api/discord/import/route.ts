import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { botToken } from '@/lib/server/discord/client';
import { startImport, toPublic } from '@/lib/server/discord/importer';

/** Inicia (ou retoma) a importação de um servidor do Discord. */
export const POST = protectedRoute(async (req) => {
  if (!botToken()) throw new ApiError(400, 'Configure DISCORD_BOT_TOKEN primeiro.');
  const b = await readBody(req);
  const guildId = typeof b.guild_id === 'string' && /^\d{5,25}$/.test(b.guild_id) ? b.guild_id : null;
  if (!guildId) throw new ApiError(400, 'Servidor inválido.');
  const job = await startImport(guildId, {
    owner_is_me: b.owner_is_me !== false,
    attachments: b.attachments !== false,
  });
  return json(toPublic(job), 201);
});
