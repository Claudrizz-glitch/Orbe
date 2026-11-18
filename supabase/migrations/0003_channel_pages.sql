-- Canais do tipo página (HTML)
alter table public.channels add column if not exists kind text not null default 'chat' check (kind in ('chat', 'page'));
alter table public.channels add column if not exists page_path text;
