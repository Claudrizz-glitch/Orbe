# ORBE

Plataforma pessoal de organização, escrita e conhecimento — espaços, categorias e canais, com acesso por senha única.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Supabase (Postgres) · Vercel.
Dependências de runtime: `next`, `react`, `react-dom`, `@supabase/supabase-js`, `server-only`.

## Arquitetura

```
Navegador ──(cookie HttpOnly)──► Endpoints Next.js (/api/*) ──(chave secreta)──► Supabase Postgres
                                   │ valida sessão no servidor
                                   │ valida origem (CSRF) e entrada
```

- O navegador **nunca** fala direto com o Supabase e não recebe nenhuma chave.
- Todas as tabelas têm RLS ativo **sem políticas** e privilégios de `anon`/`authenticated` revogados:
  a API pública do Supabase não devolve nada, mesmo que alguém conheça a URL do projeto.
- A senha fica apenas como hash **scrypt** em variável de ambiente. Sessões: token aleatório de 256 bits
  no cookie (`HttpOnly`, `SameSite=Lax`, `Secure` em produção); no banco só o SHA-256 do token.
- Limitação de tentativas persistida no banco: 5 falhas por IP / 15 min e 30 falhas globais / 15 min.

```
src/
  app/            páginas (/, /login) e endpoints (/api/...)
  components/     interface (SpaceRail, ChannelSidebar, MainPanel, ui/…)
  lib/server/     código exclusivo do servidor (db, sessão, senha, validação)
  lib/client/     chamadas à API e estado do espaço de trabalho
  styles/         tokens de tema e layout
supabase/migrations/   esquema SQL versionado
```

## Configuração

1. **Supabase:** crie um projeto e execute `supabase/migrations/0001_initial_schema.sql`
   no SQL Editor (ou via CLI/MCP).
2. **Variáveis:** copie `.env.example` para `.env.local` e preencha:
   - `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API Keys → secret)
   - `ORBE_PASSWORD_HASH`: rode `npm run hash-password` e cole a linha gerada
   - `ORBE_SESSION_SECRET`: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
3. `npm install` e `npm run dev` → http://localhost:3000

Para trocar a senha, gere um novo hash e substitua `ORBE_PASSWORD_HASH`. Para derrubar todas as
sessões abertas: `delete from access_sessions;`.

## Fases

| Fase | Conteúdo | Status |
|---|---|---|
| 1 | Fundação: projeto, banco, acesso por senha, layout, espaços/categorias/canais | ✅ |
| 2 | Mensagens, identidades, editor, datas editáveis | — |
| 3 | Arrastar e soltar, ordenação manual/cronológica, mover, respostas, fixar | — |
| 4 | Anexos (Supabase Storage) | — |
| 5 | Seleção e exportação HTML/ZIP | — |
| 6 | Personalização visual | — |
| 7 | Busca, filtros, tags, backup e restauração | — |
| 8 | PWA, tempo real, responsividade final, revisão de segurança | — |
