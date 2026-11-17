import { json, protectedRoute, readBody } from '@/lib/server/api';
import { store } from '@/lib/server/store';
import * as v from '@/lib/server/validate';
import { nextPosition } from '@/lib/server/workspace';
import { IDENTITY_COLS, type Identity, type IdentityWithCount } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Lista as identidades com a quantidade de mensagens de cada uma. */
export const GET = protectedRoute(async () => {
  const s = store();
  const rows = await s.select<Identity>('identities', { cols: IDENTITY_COLS, order: [{ col: 'is_owner', asc: false }, { col: 'position' }, { col: 'created_at' }] });
  const out: IdentityWithCount[] = [];
  for (const r of rows) out.push({ ...r, message_count: await s.count('messages', { eq: { identity_id: r.id } }) });
  return json(out);
});

export const POST = protectedRoute(async (req) => {
  const b = await readBody(req);
  const [row] = await store().insert<Identity>('identities', [{
    name: v.name(b.name),
    description: v.optText(b.description, 2000, 'Descrição') ?? null,
    color: v.optColor(b.color) ?? null,
    position: await nextPosition('identities'),
  }], { cols: IDENTITY_COLS });
  return json(row, 201);
});
