-- ═══════════════════════════════════════════════════════════════════
-- ORBE — esquema inicial
--
-- Modelo de segurança:
--   • Todas as tabelas têm RLS ativado e NENHUMA política para anon/authenticated.
--     Assim, a API pública do Supabase (PostgREST) não devolve nem altera nada,
--     mesmo que alguém descubra a URL e a chave publicável do projeto.
--   • Privilégios de anon/authenticated são revogados explicitamente.
--   • Todo acesso a dados passa pelos endpoints server-side do ORBE, que
--     validam a sessão e usam a chave secreta (service_role) apenas no servidor.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pg_trgm with schema extensions;

-- Atualiza updated_at automaticamente --------------------------------
create or replace function public.orbe_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Identidades de autoria ───────────────────────────────────────────
create table public.identities (
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
-- Apenas um perfil principal
create unique index identities_single_owner on public.identities (is_owner) where is_owner;

-- ── Espaços ──────────────────────────────────────────────────────────
create table public.spaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 100),
  icon        text check (char_length(icon) <= 32),
  color       text check (color ~ '^#[0-9a-fA-F]{6}$'),
  appearance  jsonb not null default '{}'::jsonb,
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index spaces_position_idx on public.spaces (position);

-- ── Categorias ───────────────────────────────────────────────────────
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 100),
  icon        text check (char_length(icon) <= 32),
  color       text check (color ~ '^#[0-9a-fA-F]{6}$'),
  collapsed   boolean not null default false,
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, space_id)
);
create index categories_space_position_idx on public.categories (space_id, position);

-- ── Canais ───────────────────────────────────────────────────────────
-- category_id é opcional (canais "soltos" no topo do espaço).
-- A FK composta garante que a categoria pertence ao mesmo espaço do canal.
-- Ao excluir a categoria, apenas category_id vira NULL (o canal é preservado).
create table public.channels (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references public.spaces (id) on delete cascade,
  category_id  uuid,
  name         text not null check (char_length(name) between 1 and 100),
  icon         text check (char_length(icon) <= 32),
  color        text check (color ~ '^#[0-9a-fA-F]{6}$'),
  topic        text check (char_length(topic) <= 1000),
  sort_mode    text not null default 'manual' check (sort_mode in ('manual', 'chronological')),
  position     double precision not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (category_id, space_id)
    references public.categories (id, space_id)
    on delete set null (category_id)
);
create index channels_space_category_position_idx on public.channels (space_id, category_id, position);
create index channels_category_idx on public.channels (category_id);

-- ── Mensagens ────────────────────────────────────────────────────────
-- Três registros temporais independentes:
--   created_at  → criação real (técnico, imutável)
--   updated_at  → última alteração técnica (trigger)
--   edited_at   → última edição de conteúdo feita pelo usuário
--   display_at  → data/hora EXIBIDA, livremente editável
-- position     → ordem manual, independente de display_at
create table public.messages (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references public.channels (id) on delete cascade,
  identity_id   uuid references public.identities (id) on delete set null,
  reply_to_id   uuid references public.messages (id) on delete set null,
  content       text not null default '' check (char_length(content) <= 200000),
  content_format text not null default 'markdown',
  display_at    timestamptz not null default now(),
  position      double precision not null default 0,
  pinned_at     timestamptz,
  edited_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index messages_channel_position_idx on public.messages (channel_id, position);
create index messages_channel_display_idx on public.messages (channel_id, display_at);
create index messages_identity_idx on public.messages (identity_id);
create index messages_reply_idx on public.messages (reply_to_id);
create index messages_pinned_idx on public.messages (channel_id) where pinned_at is not null;
create index messages_content_trgm_idx on public.messages using gin (content extensions.gin_trgm_ops);

-- ── Anexos ───────────────────────────────────────────────────────────
create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references public.messages (id) on delete cascade,
  storage_path  text not null unique,
  file_name     text not null check (char_length(file_name) between 1 and 255),
  mime_type     text not null default 'application/octet-stream',
  size_bytes    bigint not null default 0 check (size_bytes >= 0),
  width         integer,
  height        integer,
  position      double precision not null default 0,
  created_at    timestamptz not null default now()
);
create index attachments_message_idx on public.attachments (message_id, position);

-- ── Tags ─────────────────────────────────────────────────────────────
create table public.tags (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  color       text check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz not null default now()
);
create unique index tags_name_ci_idx on public.tags (lower(name));

create table public.message_tags (
  message_id  uuid not null references public.messages (id) on delete cascade,
  tag_id      uuid not null references public.tags (id) on delete cascade,
  primary key (message_id, tag_id)
);
create index message_tags_tag_idx on public.message_tags (tag_id);

-- ── Configurações (chave → JSON) ─────────────────────────────────────
create table public.settings (
  key         text primary key check (char_length(key) between 1 and 100),
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ── Sessões de acesso ────────────────────────────────────────────────
-- Guardamos apenas o SHA-256 do token; o token real só existe no cookie.
create table public.access_sessions (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index access_sessions_expires_idx on public.access_sessions (expires_at);

-- ── Tentativas de login (limitação de força bruta) ───────────────────
create table public.login_attempts (
  id            bigint generated always as identity primary key,
  ip_hash       text not null,
  success       boolean not null,
  attempted_at  timestamptz not null default now()
);
create index login_attempts_ip_time_idx on public.login_attempts (ip_hash, attempted_at desc);
create index login_attempts_time_idx on public.login_attempts (attempted_at desc);

-- ── Triggers updated_at ──────────────────────────────────────────────
create trigger identities_touch before update on public.identities for each row execute function public.orbe_touch_updated_at();
create trigger spaces_touch     before update on public.spaces     for each row execute function public.orbe_touch_updated_at();
create trigger categories_touch before update on public.categories for each row execute function public.orbe_touch_updated_at();
create trigger channels_touch   before update on public.channels   for each row execute function public.orbe_touch_updated_at();
create trigger messages_touch   before update on public.messages   for each row execute function public.orbe_touch_updated_at();
create trigger settings_touch   before update on public.settings   for each row execute function public.orbe_touch_updated_at();

-- ── Reordenação atômica ──────────────────────────────────────────────
-- Recebe a lista completa de IDs na nova ordem e grava position = índice.
-- Restrito a tabelas conhecidas; executado numa única transação.
create or replace function public.orbe_reorder(p_table text, p_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_table not in ('spaces', 'categories', 'channels', 'identities') then
    raise exception 'tabela não permitida: %', p_table;
  end if;
  execute format(
    'update public.%I t set position = o.ord - 1
       from unnest($1) with ordinality as o(id, ord)
      where t.id = o.id',
    p_table
  ) using p_ids;
end;
$$;

-- Move um canal para outra categoria (ou nenhuma) e reordena o destino.
create or replace function public.orbe_move_channel(
  p_channel_id uuid,
  p_category_id uuid,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.channels set category_id = p_category_id where id = p_channel_id;
  update public.channels t set position = o.ord - 1
    from unnest(p_ordered_ids) with ordinality as o(id, ord)
   where t.id = o.id;
end;
$$;

-- ── Segurança: RLS ativado, nenhuma política pública ─────────────────
alter table public.identities      enable row level security;
alter table public.spaces          enable row level security;
alter table public.categories      enable row level security;
alter table public.channels        enable row level security;
alter table public.messages        enable row level security;
alter table public.attachments     enable row level security;
alter table public.tags            enable row level security;
alter table public.message_tags    enable row level security;
alter table public.settings        enable row level security;
alter table public.access_sessions enable row level security;
alter table public.login_attempts  enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant  execute on function public.orbe_reorder(text, uuid[])           to service_role;
grant  execute on function public.orbe_move_channel(uuid, uuid, uuid[]) to service_role;

-- Novos objetos criados futuramente também nascem fechados
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ── Perfil principal ─────────────────────────────────────────────────
-- Uma identidade "Eu" é necessária para associar mensagens ao proprietário.
-- Nome e avatar podem ser alterados na Fase 2.
insert into public.identities (name, is_owner, position) values ('Eu', true, 0);
