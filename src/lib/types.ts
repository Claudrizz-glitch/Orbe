export interface SpaceAppearance {
  /** Imagem/gradiente de fundo, etc. — expandido na Fase 6. */
  [key: string]: unknown;
}

export interface Space {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  appearance: SpaceAppearance;
  position: number;
}

export interface Category {
  id: string;
  space_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  collapsed: boolean;
  position: number;
}

export type SortMode = 'manual' | 'chronological';

export interface Channel {
  id: string;
  space_id: string;
  category_id: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  topic: string | null;
  sort_mode: SortMode;
  position: number;
}

export interface Workspace {
  spaces: Space[];
  categories: Category[];
  channels: Channel[];
}

export const SPACE_COLS = 'id, name, icon, color, appearance, position';
export const CATEGORY_COLS = 'id, space_id, name, icon, color, collapsed, position';
export const CHANNEL_COLS = 'id, space_id, category_id, name, icon, color, topic, sort_mode, position';
