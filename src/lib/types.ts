export interface SpaceAppearance {
  /** Imagem/gradiente de fundo, etc. — expandido na Fase 6. */
  [key: string]: unknown;
}

export interface Space {
  id: string;
  name: string;
  icon: string | null;
  /** Imagem de ícone (ex.: ícone do servidor importado do Discord) */
  icon_path: string | null;
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
  /** 'chat' = conversa; 'page' = exibe um documento HTML */
  kind: ChannelKind;
  page_path: string | null;
}

export type ChannelKind = 'chat' | 'page';

export interface Identity {
  id: string;
  name: string;
  avatar_path: string | null;
  description: string | null;
  color: string | null;
  is_owner: boolean;
  position: number;
}

export interface Workspace {
  spaces: Space[];
  categories: Category[];
  channels: Channel[];
  identities: Identity[];
  storage: 'local' | 'postgres' | 'supabase';
}

export interface Attachment {
  id: string;
  message_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
}

export interface Embed { title?: string; description?: string; url?: string; color?: number; author?: string; footer?: string }

export interface Message {
  id: string;
  channel_id: string;
  identity_id: string | null;
  reply_to_id: string | null;
  content: string;
  display_at: string;
  edited_at: string | null;
  pinned_at: string | null;
  position: number;
  extra: { embeds?: Embed[]; stickers?: string[]; discord?: { author?: string } };
  /** criação real (técnica, imutável) */
  created_at: string;
  /** última alteração técnica */
  updated_at: string;
}

export interface IdentityWithCount extends Identity { message_count: number }

export interface ReplyPreview { id: string; identity_id: string | null; content: string }

export interface MessagePage {
  messages: Message[];
  attachments: Attachment[];
  replies: ReplyPreview[];
  has_more: boolean;
}

export interface ImportStats {
  categories: number; channels: number; messages: number; attachments: number; identities: number;
  skipped_channels: number; skipped_messages: number; failed_attachments: number; bytes: number;
}

export interface ImportJob {
  id: string; name: string; guild_id: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  space_id: string | null;
  stats: ImportStats;
  log: { t: string; level: 'info' | 'warn'; msg: string }[];
  error: string | null;
  progress: { phase: 'structure' | 'messages' | 'done'; channel: number; total: number; current: string | null; pending_files: number };
  created_at: string; updated_at: string;
}

export interface DiscordStatus {
  configured: boolean;
  storage: 'local' | 'postgres' | 'supabase';
  error?: string;
  bot?: { id: string; name: string };
  message_content?: boolean;
  invite_url?: string;
  invite_admin_url?: string;
  guilds?: { id: string; name: string; icon_url: string | null; space_id: string | null }[];
  jobs: ImportJob[];
}

export interface ExportChannel {
  id: string; name: string; topic: string | null; icon: string | null; sort_mode: string;
  space: string; category: string | null;
}
export interface ExportData {
  channels: ExportChannel[];
  messages: Message[];
  attachments: Attachment[];
  identities: Identity[];
  replies: { id: string; identity_id: string | null; content: string }[];
}

export const SPACE_COLS = 'id, name, icon, icon_path, color, appearance, position';
export const CATEGORY_COLS = 'id, space_id, name, icon, color, collapsed, position';
export const CHANNEL_COLS = 'id, space_id, category_id, name, icon, color, topic, sort_mode, position, kind, page_path';
export const IDENTITY_COLS = 'id, name, avatar_path, description, color, is_owner, position';
export const MESSAGE_COLS = 'id, channel_id, identity_id, reply_to_id, content, display_at, edited_at, pinned_at, position, extra, created_at, updated_at';
