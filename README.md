# ORBE

Plataforma pessoal de organização, escrita e conhecimento — espaços, categorias e canais, com acesso por senha única e importação de servidores do Discord.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Postgres (Neon) · Vercel.
Dependências de runtime: `next`, `react`, `react-dom`, `postgres`, `server-only` (e `@supabase/supabase-js`, opcional/legado).

## Arquitetura

```
Navegador ──(cookie HttpOnly)──► Endpoints Next.js (/api/*) ──► Store (Neon/Postgres | local em disco | Supabase)
                                   │ valida sessão no servidor
                                   │ valida origem (CSRF) e entrada
```

- O navegador **nunca** fala direto com o banco e não recebe nenhuma chave.
- No Neon, o banco só aceita a connection string que fica no servidor (`DATABASE_URL`); não há API pública.
- No Supabase (opcional), todas as tabelas têm RLS ativo **sem políticas** e privilégios de `anon`/`authenticated` revogados:
  a API pública não devolve nada, mesmo que alguém conheça a URL do projeto.
- A senha fica apenas como hash **scrypt** em variável de ambiente. Sessões: token aleatório de 256 bits
  no cookie (`HttpOnly`, `SameSite=Lax`, `Secure` em produção); no banco só o SHA-256 do token.
- Limitação de tentativas persistida: 5 falhas por IP / 15 min e 30 falhas globais / 15 min.
- Arquivos (anexos, avatares, ícones) só são entregues por `/api/files/...` após validar a sessão.

```
src/
  app/            páginas (/, /login) e endpoints (/api/...)
  components/     interface (SpaceRail, ChannelSidebar, MainPanel, MessageList, DiscordImportDialog, ui/…)
  lib/server/     código exclusivo do servidor (store Postgres/local/Supabase, sessão, senha, Discord)
  lib/client/     chamadas à API e estado do espaço de trabalho
  lib/markdown.ts renderizador Markdown (dialeto Discord) seguro
  styles/         tokens de tema e layout
db/schema.sql          esquema Postgres (Neon) — aplicado por npm run db:setup
supabase/migrations/   esquema para Supabase (opcional)
```

## Armazenamento

| Modo | Onde ficam os dados | Uso |
|---|---|---|
| `local` | pasta `orbe-data/` (JSON + arquivos), fora do git | seu computador; serve de **backup** portátil |
| `postgres` | Neon (Postgres); anexos na tabela `files` | **produção** / Vercel / vários dispositivos |
| `supabase` | Postgres + Storage (bucket privado `orbe-files`) | alternativa |

Defina `ORBE_STORAGE` no `.env.local`. O modo local é bloqueado em produção.

## Configuração rápida (modo local)

1. `npm install`
2. Copie `.env.example` para `.env.local` e preencha `ORBE_PASSWORD_HASH` (gere com `npm run hash-password`) e `ORBE_SESSION_SECRET`.
3. `npm run dev` → http://localhost:3000

## Neon (banco na nuvem)

1. No Neon: seu projeto → **Connect** → copie a *pooled connection string*.
2. No `.env.local`: `DATABASE_URL=...` e `ORBE_STORAGE=postgres`.
3. `npm run db:setup` — cria as tabelas (pode repetir sem risco).
4. `npm run db:import-local` — copia o backup `orbe-data/` (servidores importados, identidades, anexos) para o Neon. Pode repetir: nunca duplica.
5. Reinicie o `npm run dev`.

## Importar do Discord

Usa um **bot oficial** — nunca o token da sua conta (isso viola os termos do Discord e pode banir a conta).

1. https://discord.com/developers/applications → **New Application**.
2. Menu **Bot** → ative **Message Content Intent** → **Reset Token** e copie o token.
3. No `.env.local`: `DISCORD_BOT_TOKEN=...` e reinicie o `npm run dev`.
4. No ORBE, botão do Discord na barra de espaços → **Adicionar bot a um servidor** → escolha o servidor → **Importar servidor**.

**O que é importado:** servidor → espaço (com ícone), categorias, canais de texto/anúncio/voz, tópicos e posts de
fórum, mensagens com data original, formatação, respostas, fixadas, embeds e anexos (até 50 MB cada). Cada autor
vira uma **identidade** (nome e avatar); personagens de webhook (Tupperbox/PluralKit) viram identidades separadas;
as mensagens do dono do servidor podem aparecer como “Eu”.

A importação roda em etapas curtas, pode ser pausada/retomada e **nunca duplica**: reimportar traz apenas o que é novo.
Mensagens de sistema (entradas de membros, etc.) são ignoradas. Canais sem permissão de leitura são listados como aviso.

## Fases

| Fase | Conteúdo | Status |
|---|---|---|
| 1 | Fundação: projeto, banco, acesso por senha, layout, espaços/categorias/canais | ✅ |
| — | Visual noturno · importação do Discord · leitura de mensagens · modo local | ✅ |
| 2 | Escrever/editar/duplicar/excluir mensagens, identidades (avatar, cor, mesclar), editor com formatação, datas editáveis | ✅ |
| — | Banco Neon (Postgres) + migração do backup local | ✅ |
| 3 | Arrastar e soltar (mensagens, canais entre categorias, categorias, espaços — com toque), ordem manual/cronológica, mover mensagens entre canais, respostas, fixadas, link interno | ✅ |
| 4 | Envio de anexos pelo ORBE | — |
| 5 | Seleção e exportação HTML/ZIP | — |
| 6 | Personalização visual (temas, cores, fontes, densidade) | — |
| 7 | Busca, filtros, tags, backup e restauração | — |
| 8 | PWA, tempo real, responsividade final, revisão de segurança | — |
