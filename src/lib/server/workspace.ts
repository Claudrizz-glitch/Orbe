import 'server-only';
import { db } from './db';
import { CATEGORY_COLS, CHANNEL_COLS, SPACE_COLS, type Workspace } from '../types';

export async function loadWorkspace(): Promise<Workspace> {
  const [spaces, categories, channels] = await Promise.all([
    db().from('spaces').select(SPACE_COLS).order('position').order('created_at'),
    db().from('categories').select(CATEGORY_COLS).order('position').order('created_at'),
    db().from('channels').select(CHANNEL_COLS).order('position').order('created_at'),
  ]);
  if (spaces.error) throw spaces.error;
  if (categories.error) throw categories.error;
  if (channels.error) throw channels.error;
  return { spaces: spaces.data, categories: categories.data, channels: channels.data } as Workspace;
}

/** Próxima posição no final de uma lista. */
export async function nextPosition(
  table: 'spaces' | 'categories' | 'channels',
  filter: Record<string, string | null> = {},
): Promise<number> {
  let q = db().from(table).select('position').order('position', { ascending: false }).limit(1);
  for (const [k, v] of Object.entries(filter)) q = v === null ? q.is(k, null) : q.eq(k, v);
  const { data, error } = await q;
  if (error) throw error;
  return data && data.length ? Number(data[0].position) + 1 : 0;
}
