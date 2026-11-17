-- ═══════════════════════════════════════════════════════════════════
-- ORBE — importação (Discord) e armazenamento de arquivos
-- ═══════════════════════════════════════════════════════════════════

-- Referência de origem de uma mensagem importada (ex.: 'discord:123456').
-- UNIQUE garante que reimportar nunca duplica mensagens.
alter table public.messages add column source_ref text unique;

-- Dados extras preservados na importação (embeds, figurinhas, IDs originais).
alter table public.messages add column extra jsonb not null default '{}'::jsonb;

-- Imagem de ícone opcional para espaços (ex.: ícone do servidor importado).
alter table public.spaces add column icon_path text;

-- Mapa origem → ORBE para espaços, categorias, canais e identidades.
-- Permite retomar e reimportar sem duplicar.
create table public.import_map (
  source       text not null,
  kind         text not null check (kind in ('space', 'category', 'channel', 'identity')),
  external_id  text not null,
  local_id     uuid not null,
  created_at   timestamptz not null default now(),
  primary key (source, kind, external_id)
);
create index import_map_local_idx on public.import_map (local_id);

-- Trabalhos de importação retomáveis (processados em etapas curtas,
-- compatíveis com o limite de tempo das funções da Vercel).
create table public.import_jobs (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (source in ('discord')),
  external_id  text not null,
  name         text not null,
  space_id     uuid references public.spaces (id) on delete set null,
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
create index import_jobs_status_idx on public.import_jobs (status, created_at desc);
create trigger import_jobs_touch before update on public.import_jobs for each row execute function public.orbe_touch_updated_at();

alter table public.import_map  enable row level security;
alter table public.import_jobs enable row level security;
revoke all on public.import_map, public.import_jobs from anon, authenticated;

-- Bucket privado para anexos, avatares e ícones. Sem políticas: apenas o
-- servidor (chave secreta) lê e grava; o navegador recebe URLs assinadas
-- de curta duração emitidas após validar a sessão.
insert into storage.buckets (id, name, public, file_size_limit)
values ('orbe-files', 'orbe-files', false, 52428800)
on conflict (id) do nothing;
