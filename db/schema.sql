-- ═══════════════════════════════════════════════════════════════════
-- ORBE — esquema Postgres (Neon ou qualquer Postgres 14+)
-- Idempotente: pode ser executado mais de uma vez (npm run db:setup).
--
-- Segurança: o banco é acessado APENAS pelo servidor do ORBE, com a
-- connection string em variável de ambiente (DATABASE_URL). Não há API
-- pública; o navegador nunca recebe credenciais.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pg_trgm;

create or replace function orbe_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

-- ── Identidades ──────────────────────────────────────────────────────
create table if not exists identities (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 100),
  avatar_path  text,
  description  text check (char_length(description) <= 2000),
  color        text check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_owner     boolean not null default false,
  position     double precision not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists identities_single_owner on identities (is_owner) where is_owner;

-- ── Espaços, categorias, canais ─────────────────────────────────────
create table if not exists spaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 100),
  icon        text check (char_length(icon) <= 32),
  icon_path   text,
  color       text check (color ~ '^#[0-9a-fA-F]{6}$'),
  appearance  jsonb not null default '{}'::jsonb,
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists spaces_position_idx on spaces (position);

create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references spaces (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 100),
  icon        text check (char_length(icon) <= 32),
  color       text check (color ~ '^#[0-9a-fA-F]{6}$'),
  collapsed   boolean not null default false,
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, space_id)
);
create index if not exists categories_space_position_idx on categories (space_id, position);

create table if not exists channels (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references spaces (id) on delete cascade,
  category_id  uuid,
  name         text not null check (char_length(name) between 1 and 100),
  icon         text check (char_length(icon) <= 32),
  color        text check (color ~ '^#[0-9a-fA-F]{6}$'),
  topic        text check (char_length(topic) <= 1000),
  sort_mode    text not null default 'manual' check (sort_mode in ('manual', 'chronological')),
  position     double precision not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (category_id, space_id) references categories (id, space_id) on delete set null (category_id)
);
create index if not exists channels_space_category_position_idx on channels (space_id, category_id, position);
create index if not exists channels_category_idx on channels (category_id);

-- ── Mensagens ────────────────────────────────────────────────────────
-- created_at = criação real · updated_at = alteração técnica
-- edited_at  = última edição do texto · display_at = data EXIBIDA (editável)
-- position   = ordem manual, independente das datas
create table if not exists messages (
  id             uuid primary key default gen_random_uuid(),
  channel_id     uuid not null references channels (id) on delete cascade,
  identity_id    uuid references identities (id) on delete set null,
  reply_to_id    uuid references messages (id) on delete set null,
  content        text not null default '' check (char_length(content) <= 200000),
  content_format text not null default 'markdown',
  display_at     timestamptz not null default now(),
  position       double precision not null default 0,
  pinned_at      timestamptz,
  edited_at      timestamptz,
  source_ref     text unique,
  extra          jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists messages_channel_position_idx on messages (channel_id, position);
create index if not exists messages_channel_display_idx on messages (channel_id, display_at);
create index if not exists messages_identity_idx on messages (identity_id);
create index if not exists messages_reply_idx on messages (reply_to_id);
create index if not exists messages_pinned_idx on messages (channel_id) where pinned_at is not null;
create index if not exists messages_content_trgm_idx on messages using gin (content gin_trgm_ops);

create table if not exists attachments (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references messages (id) on delete cascade,
  storage_path  text not null unique,
  file_name     text not null check (char_length(file_name) between 1 and 255),
  mime_type     text not null default 'application/octet-stream',
  size_bytes    bigint not null default 0 check (size_bytes >= 0),
  width         integer,
  height        integer,
  position      double precision not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists attachments_message_idx on attachments (message_id, position);

create table if not exists tags (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  color       text check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz not null default now()
);
create unique index if not exists tags_name_ci_idx on tags (lower(name));
create table if not exists message_tags (
  message_id  uuid not null references messages (id) on delete cascade,
  tag_id      uuid not null references tags (id) on delete cascade,
  primary key (message_id, tag_id)
);

create table if not exists settings (
  key         text primary key check (char_length(key) between 1 and 100),
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ── Acesso ───────────────────────────────────────────────────────────
create table if not exists access_sessions (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index if not exists access_sessions_expires_idx on access_sessions (expires_at);

create table if not exists login_attempts (
  id            bigint generated always as identity primary key,
  ip_hash       text not null,
  success       boolean not null,
  attempted_at  timestamptz not null default now()
);
create index if not exists login_attempts_ip_time_idx on login_attempts (ip_hash, attempted_at desc);

-- ── Importação ───────────────────────────────────────────────────────
create table if not exists import_map (
  source       text not null,
  kind         text not null check (kind in ('space', 'category', 'channel', 'identity')),
  external_id  text not null,
  local_id     uuid not null,
  created_at   timestamptz not null default now(),
  primary key (source, kind, external_id)
);
create index if not exists import_map_local_idx on import_map (local_id);

create table if not exists import_jobs (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (source in ('discord')),
  external_id  text not null,
  name         text not null,
  space_id     uuid references spaces (id) on delete set null,
  status       text not null default 'running' check (status in ('running', 'done', 'error', 'cancelled')),
  options      jsonb not null default '{}'::jsonb,
  state        jsonb not null default '{}'::jsonb,
  stats        jsonb not null default '{}'::jsonb,
  log          jsonb not null default '[]'::jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  finished_at  timestamptz
);

-- ── Arquivos (anexos, avatares, ícones) ─────────────────────────────
-- Guardados no próprio banco: simples e sem serviço extra. Se o volume
-- crescer muito, basta trocar por um armazenamento de objetos.
create table if not exists files (
  path          text primary key,
  content_type  text not null,
  size_bytes    integer not null,
  data          bytea not null,
  created_at    timestamptz not null default now()
);

-- ── Gatilhos updated_at ─────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['identities','spaces','categories','channels','messages','settings','import_jobs'] loop
    if not exists (select 1 from pg_trigger where tgname = t || '_touch') then
      execute format('create trigger %I before update on %I for each row execute function orbe_touch_updated_at()', t || '_touch', t);
    end if;
  end loop;
end $$;

-- ── Perfil principal ─────────────────────────────────────────────────
insert into identities (name, is_owner, position)
select 'Eu', true, 0 where not exists (select 1 from identities where is_owner);
