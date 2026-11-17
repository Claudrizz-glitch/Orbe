import { ApiError, json, protectedRoute, readBody } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { MESSAGE_COLS, type Message } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Move uma mensagem na ordem manual e/ou para outro canal.
 * Body: { after_id?: uuid|null, before_id?: uuid|null, channel_id?: uuid }
 *   after_id  = mensagem que deve ficar imediatamente ACIMA
 *   before_id = mensagem que deve ficar imediatamente ABAIXO
 *   sem vizinhos → vai para o fim do canal de destino
 * A posição é fracionária (entre os vizinhos); a data exibida não muda.
 */
export const POST = protectedRoute<Ctx>(async (req, { params }) => {
  const id = v.uuid((await params).id);
  const b = await readBody(req);
  const s = store();

  const [msg] = await s.select<Message>('messages', { cols: 'id, channel_id, position', eq: { id } });
  if (!msg) throw new ApiError(404, 'Mensagem não encontrada.');
  const channel_id = b.channel_id == null ? msg.channel_id : v.uuid(b.channel_id, 'Canal');
  if (channel_id !== msg.channel_id && !(await s.count('channels', { eq: { id: channel_id } }))) throw new ApiError(404, 'Canal de destino não encontrado.');

  const neighbor = async (key: 'after_id' | 'before_id') => {
    if (b[key] == null) return null;
    const nid = v.uuid(b[key], 'Mensagem vizinha');
    const [n] = await s.select<{ position: number; channel_id: string }>('messages', { cols: 'position, channel_id', eq: { id: nid } });
    if (!n || n.channel_id !== channel_id) throw new ApiError(400, 'A mensagem vizinha não está no canal de destino.');
    return Number(n.position);
  };
  const a = await neighbor('after_id');
  const z = await neighbor('before_id');

  let position: number;
  if (a !== null && z !== null) position = (a + z) / 2;
  else if (a !== null) position = a + 1;
  else if (z !== null) position = z - 1;
  else {
    const [last] = await s.select<{ position: number }>('messages', { cols: 'position', eq: { channel_id }, order: [{ col: 'position', asc: false }], limit: 1 });
    position = last ? Number(last.position) + 1 : 0;
  }

  await s.update('messages', { eq: { id } }, { channel_id, position }, 'id');

  // Divisões sucessivas esgotam a precisão: renumera o canal quando os vizinhos ficam colados demais
  if (a !== null && z !== null && Math.abs(z - a) < 1e-6) {
    const all = await s.select<{ id: string }>('messages', { cols: 'id', eq: { channel_id }, order: [{ col: 'position' }, { col: 'created_at' }] });
    await s.reorder('messages', all.map((m) => m.id));
  }

  const [row] = await s.select<Message>('messages', { cols: MESSAGE_COLS, eq: { id } });
  return json(row);
});
