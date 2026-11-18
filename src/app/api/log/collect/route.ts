import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { COLORS, addLogAuthors, audit, describeChannel, discordReadable, isLogChannel, logTarget } from '@/lib/server/audit';
import type { Embed, Identity, Message } from '@/lib/types';

export const maxDuration = 60;

/**
 * Leva TODAS as mensagens das identidades indicadas para o #log como registros
 * soltos (sem autor nem avatar), anotando a conversa de origem, e exclui os perfis.
 * Pensado para bots de registro como a Loritta.
 * Body: { identity_ids: uuid[] }
 */
export const POST = protectedRoute(async (req) => {
  const b = await readBody(req);
  if (!Array.isArray(b.identity_ids) || !b.identity_ids.length || b.identity_ids.length > 50) throw new ApiError(400, 'Identidades inválidas.');
  const ids = [...new Set(b.identity_ids.map((x) => v.uuid(x, 'Identidade')))];
  const s = store();

  const idns = await s.select<Identity>('identities', { cols: 'id, name, avatar_path, is_owner', in: { id: ids } });
  if (idns.some((i) => i.is_owner)) throw new ApiError(400, 'O perfil principal não pode ir para o LOG.');
  if (!idns.length) throw new ApiError(404, 'Identidades não encontradas.');

  const { channelId: logId } = await logTarget();

  // Nomes legíveis para as marcações do Discord dentro dos registros
  const readable = await discordReadable();
  // Mensagens futuras destes autores (reimportações) também vão direto ao #log
  const authorIds = (await s.select<{ external_id: string }>('import_map', { eq: { source: 'discord', kind: 'identity' }, in: { local_id: ids } }))
    .map((r) => r.external_id.replace(/^webhook:(\d+):.*$/, '$1')).filter((x) => /^\d+$/.test(x));
  await addLogAuthors(authorIds);

  let moved = 0;
  const origins = new Map<string, number>();
  for (const idn of idns) {
    const msgs = await s.select<Message>('messages', { cols: 'id, channel_id, content, extra', eq: { identity_id: idn.id } });
    for (const m of msgs) {
      if (m.channel_id === logId || (await isLogChannel(m.channel_id))) continue;
      const origin = await describeChannel(m.channel_id);
      const embeds: Embed[] = (m.extra?.embeds ?? []).map((e) => ({
        ...e,
        description: readable(e.description),
        title: readable(e.title),
        footer: [e.footer, `Origem: ${origin} · registrado por ${idn.name}`].filter(Boolean).join(' · '),
      }));
      await s.update('messages', { eq: { id: m.id } }, {
        channel_id: logId,
        identity_id: null,
        content: readable(m.content) ?? '',
        extra: { ...m.extra, embeds, system: true, origin, collected_from: idn.name },
      }, 'id');
      moved++;
      origins.set(origin, (origins.get(origin) ?? 0) + 1);
    }
  }

  // Exclui os perfis (as mensagens já não dependem deles)
  for (const idn of idns) {
    await s.remove('identities', { eq: { id: idn.id } });
    if (idn.avatar_path) await s.removeFile(idn.avatar_path).catch(() => {});
  }

  await audit({
    title: `Mensagens de ${idns.map((i) => i.name).join(', ')} levadas ao LOG`, color: COLORS.move, author: 'ORBE',
    fields: [
      { label: 'Registros movidos', value: String(moved) },
      { label: 'Vindos de', value: [...origins].map(([o, n]) => `${o}: ${n}`).join(' · ') || '—' },
      { label: 'Perfis excluídos', value: idns.map((i) => i.name).join(', ') },
    ],
    footer: 'As mensagens agora são registros soltos no #log, ordenados pela data original.',
    ref: { event: 'log.collect', identities: idns.map((i) => i.id), moved },
  });

  return json({ ok: true, moved, deleted_identities: idns.length, origins: Object.fromEntries(origins) });
});
