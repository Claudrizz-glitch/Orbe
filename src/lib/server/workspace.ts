import 'server-only';
import { store } from './store';
import { CATEGORY_COLS, CHANNEL_COLS, IDENTITY_COLS, SPACE_COLS, type Workspace } from '../types';

const byPos = [{ col: 'position' }, { col: 'created_at' }];

export async function loadWorkspace(): Promise<Workspace> {
  const s = store();
  const [spaces, categories, channels, identities] = await Promise.all([
    s.select('spaces', { cols: SPACE_COLS, order: byPos }),
    s.select('categories', { cols: CATEGORY_COLS, order: byPos }),
    s.select('channels', { cols: CHANNEL_COLS, order: byPos }),
    s.select('identities', { cols: IDENTITY_COLS, order: byPos }),
  ]);
  return { spaces, categories, channels, identities, storage: s.kind } as unknown as Workspace;
}

/** Próxima posição no final de uma lista. */
export async function nextPosition(
  table: 'spaces' | 'categories' | 'channels' | 'identities',
  eq: Record<string, string | null> = {},
): Promise<number> {
  const [last] = await store().select<{ position: number }>(table, {
    cols: 'position', eq, order: [{ col: 'position', asc: false }], limit: 1,
  });
  return last ? Number(last.position) + 1 : 0;
}
