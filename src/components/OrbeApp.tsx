'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Category, Channel, ImportJob, Space, Workspace } from '@/lib/types';
import { DiscordImportDialog } from './DiscordImportDialog';
import { IdentitiesDialog } from './IdentitiesDialog';
import { shift, useWorkspace } from '@/lib/client/useWorkspace';
import { api } from '@/lib/client/api';
import { SpaceRail } from './SpaceRail';
import { ChannelSidebar } from './ChannelSidebar';
import { MainPanel } from './MainPanel';
import { EntityDialog, type EntityValues } from './EntityDialog';
import { useToast } from './ui/Toasts';
import { useConfirm } from './ui/ConfirmDialog';
import type { MenuEntry } from './ui/ContextMenu';
import { IconDown, IconEdit, IconFolder, IconHash, IconTrash, IconUp } from './ui/Icons';

type Dialog =
  | { kind: 'space'; space?: Space }
  | { kind: 'category'; spaceId: string; category?: Category }
  | { kind: 'channel'; spaceId: string; categoryId: string | null; channel?: Channel }
  | null;

// Preferências de navegação deste dispositivo (conveniência; não são dados do usuário)
const LS_LAST = 'orbe:last-channel-by-space';
const LS_NAV = 'orbe:nav-hidden';
const readLS = <T,>(k: string, fallback: T): T => {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
};
const writeLS = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function OrbeApp({ initial }: { initial: Workspace }) {
  const w = useWorkspace(initial);
  const toast = useToast();
  const confirm = useConfirm();

  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [navHidden, setNavHidden] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [ready, setReady] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [paused, setPaused] = useState(false);

  // ── Importação: chama etapas curtas no servidor até concluir ──
  useEffect(() => {
    if (!job || job.status !== 'running' || paused) return;
    let alive = true;
    (async () => {
      let lastRefresh = Date.now();
      while (alive) {
        try {
          const j = await api<ImportJob>(`/api/discord/import/${job.id}/step`, { method: 'POST' });
          if (!alive) break;
          setJob(j);
          // Mostra canais e identidades novos enquanto importa
          if (Date.now() - lastRefresh > 15000) { lastRefresh = Date.now(); w.refresh().catch(() => {}); }
          if (j.status !== 'running') {
            await w.refresh().catch(() => {});
            if (j.status === 'done') toast.success(`“${j.name}” importado: ${j.stats.messages.toLocaleString('pt-BR')} mensagens.`);
            else if (j.status === 'error') toast.error('A importação foi interrompida. Abra a janela de importação para continuar.');
            break;
          }
        } catch (e) {
          if (!alive) break;
          toast.error(`Importação pausada: ${(e as Error).message}`);
          setPaused(true);
          break;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status, paused]);

  async function jobAction(action: 'resume' | 'cancel') {
    if (!job) return;
    try { setJob(await api<ImportJob>(`/api/discord/import/${job.id}`, { method: 'PATCH', body: { action } })); setPaused(false); }
    catch (e) { toast.error((e as Error).message); }
  }

  const identities = useMemo(() => new Map(w.ws.identities.map((i) => [i.id, i])), [w.ws.identities]);

  // Identidade ativa no campo de escrita (lembrada neste dispositivo)
  const [activeIdentity, setActiveIdentity] = useState<string | null>(null);
  const [identitiesOpen, setIdentitiesOpen] = useState(false);
  useEffect(() => { setActiveIdentity(readLS<string | null>('orbe:active-identity', null)); }, []);
  const chooseIdentity = (id: string) => { setActiveIdentity(id); writeLS('orbe:active-identity', id); };
  const activeIdentityId = activeIdentity && identities.has(activeIdentity) ? activeIdentity : w.ws.identities.find((i) => i.is_owner)?.id ?? null;

  // ── Seleção inicial: URL → último canal usado → primeiro disponível ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get('c');
    const s = params.get('s');
    const ch = c ? w.ws.channels.find((x) => x.id === c) : undefined;
    if (ch) { setSpaceId(ch.space_id); setChannelId(ch.id); }
    else if (s && w.ws.spaces.some((x) => x.id === s)) selectSpace(s);
    else if (w.spaces[0]) selectSpace(w.spaces[0].id);
    setNavHidden(readLS(LS_NAV, false));
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mantém a URL coerente (permite favoritar / recarregar no mesmo canal)
  useEffect(() => {
    if (!ready) return;
    const base = window.location.pathname;
    const url = channelId ? `${base}?c=${channelId}` : spaceId ? `${base}?s=${spaceId}` : base;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, '', url);
  }, [ready, spaceId, channelId]);

  // Se o espaço/canal ativo deixar de existir (excluído aqui ou em outro dispositivo)
  useEffect(() => {
    if (!ready) return;
    if (spaceId && !w.ws.spaces.some((s) => s.id === spaceId)) {
      const first = w.spaces[0];
      if (first) selectSpace(first.id); else { setSpaceId(null); setChannelId(null); }
    } else if (channelId && !w.ws.channels.some((c) => c.id === channelId)) {
      setChannelId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.ws, ready]);

  const toggleNav = useCallback(() => {
    setNavHidden((h) => { writeLS(LS_NAV, !h); return !h; });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') { e.preventDefault(); toggleNav(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleNav]);

  function selectSpace(id: string) {
    setSpaceId(id);
    const last = readLS<Record<string, string>>(LS_LAST, {})[id];
    const chans = w.ws.channels.filter((c) => c.space_id === id);
    const pick = chans.find((c) => c.id === last)
      ?? w.channelsOf(id, null)[0]
      ?? w.categoriesOf(id).map((cat) => w.channelsOf(id, cat.id)[0]).find(Boolean)
      ?? null;
    setChannelId(pick?.id ?? null);
  }

  function selectChannel(id: string) {
    setChannelId(id);
    setDrawer(false);
    if (spaceId) writeLS(LS_LAST, { ...readLS<Record<string, string>>(LS_LAST, {}), [spaceId]: id });
  }

  /** Executa uma ação mostrando erro em notificação (nunca falha em silêncio). */
  async function run(fn: () => Promise<unknown>, ok?: string) {
    try { await fn(); if (ok) toast.success(ok); }
    catch (e) { toast.error((e as Error).message); }
  }

  const space = useMemo(() => w.ws.spaces.find((s) => s.id === spaceId) ?? null, [w.ws.spaces, spaceId]);
  const channel = useMemo(() => w.ws.channels.find((c) => c.id === channelId) ?? null, [w.ws.channels, channelId]);
  const category = useMemo(
    () => (channel?.category_id ? w.ws.categories.find((c) => c.id === channel.category_id) ?? null : null),
    [w.ws.categories, channel],
  );

  // ── Menus ────────────────────────────────────────────────
  const move = (table: 'spaces' | 'categories' | 'channels', ids: string[], id: string, dir: -1 | 1) => {
    const next = shift(ids, id, dir);
    return { disabled: !next, onSelect: () => next && run(() => w.reorder(table, next)) };
  };

  const spaceMenu = (s: Space): MenuEntry[] => {
    const ids = w.spaces.map((x) => x.id);
    return [
      { label: 'Editar espaço', icon: <IconEdit size={16} />, onSelect: () => setDialog({ kind: 'space', space: s }) },
      { label: 'Nova categoria', icon: <IconFolder size={16} />, onSelect: () => setDialog({ kind: 'category', spaceId: s.id }) },
      { label: 'Novo canal', icon: <IconHash size={16} />, onSelect: () => setDialog({ kind: 'channel', spaceId: s.id, categoryId: null }) },
      'separator',
      { label: 'Mover para cima', icon: <IconUp size={16} />, ...move('spaces', ids, s.id, -1) },
      { label: 'Mover para baixo', icon: <IconDown size={16} />, ...move('spaces', ids, s.id, 1) },
      'separator',
      { label: 'Excluir espaço', icon: <IconTrash size={16} />, danger: true, onSelect: () => removeSpace(s) },
    ];
  };

  const categoryMenu = (c: Category): MenuEntry[] => {
    const ids = w.categoriesOf(c.space_id).map((x) => x.id);
    return [
      { label: 'Editar categoria', icon: <IconEdit size={16} />, onSelect: () => setDialog({ kind: 'category', spaceId: c.space_id, category: c }) },
      { label: 'Novo canal aqui', icon: <IconHash size={16} />, onSelect: () => setDialog({ kind: 'channel', spaceId: c.space_id, categoryId: c.id }) },
      'separator',
      { label: 'Mover para cima', icon: <IconUp size={16} />, ...move('categories', ids, c.id, -1) },
      { label: 'Mover para baixo', icon: <IconDown size={16} />, ...move('categories', ids, c.id, 1) },
      'separator',
      { label: 'Excluir categoria', icon: <IconTrash size={16} />, danger: true, onSelect: () => removeCategory(c) },
    ];
  };

  const channelMenu = (c: Channel): MenuEntry[] => {
    const ids = w.channelsOf(c.space_id, c.category_id).map((x) => x.id);
    return [
      { label: 'Editar canal', icon: <IconEdit size={16} />, onSelect: () => setDialog({ kind: 'channel', spaceId: c.space_id, categoryId: c.category_id, channel: c }) },
      'separator',
      { label: 'Mover para cima', icon: <IconUp size={16} />, ...move('channels', ids, c.id, -1) },
      { label: 'Mover para baixo', icon: <IconDown size={16} />, ...move('channels', ids, c.id, 1) },
      'separator',
      { label: 'Excluir canal', icon: <IconTrash size={16} />, danger: true, onSelect: () => removeChannel(c) },
    ];
  };

  // ── Exclusões com confirmação ────────────────────────────
  async function removeSpace(s: Space) {
    const nCat = w.ws.categories.filter((c) => c.space_id === s.id).length;
    const nCh = w.ws.channels.filter((c) => c.space_id === s.id).length;
    const ok = await confirm({
      title: `Excluir “${s.name}”?`,
      danger: true,
      confirmLabel: 'Excluir espaço',
      message: <>
        <p>Isto excluirá permanentemente o espaço, {plural(nCat, 'categoria', 'categorias')} e {plural(nCh, 'canal', 'canais')}, incluindo todas as mensagens desses canais.</p>
        <p className="muted">Esta ação não pode ser desfeita.</p>
      </>,
    });
    if (ok) run(() => w.deleteSpace(s.id), 'Espaço excluído.');
  }

  async function removeCategory(c: Category) {
    const nCh = w.ws.channels.filter((x) => x.category_id === c.id).length;
    const choice = await confirm({
      title: `Excluir a categoria “${c.name}”?`,
      danger: true,
      confirmLabel: 'Excluir categoria',
      message: nCh === 0
        ? <p>A categoria está vazia.</p>
        : <p>Ela contém {plural(nCh, 'canal', 'canais')}. O que fazer com eles?</p>,
      choices: nCh === 0 ? undefined : [
        { value: 'keep', label: 'Manter os canais', hint: 'Eles ficam no espaço, sem categoria.' },
        { value: 'delete', label: 'Excluir os canais também', hint: 'Inclui todas as mensagens. Não pode ser desfeito.' },
      ],
    });
    if (choice) run(() => w.deleteCategory(c.id, choice === 'delete' ? 'delete' : 'keep'), 'Categoria excluída.');
  }

  async function removeChannel(c: Channel) {
    const ok = await confirm({
      title: `Excluir #${c.name}?`,
      danger: true,
      confirmLabel: 'Excluir canal',
      message: <>
        <p>O canal e todas as suas mensagens serão excluídos permanentemente.</p>
        <p className="muted">Esta ação não pode ser desfeita.</p>
      </>,
    });
    if (ok) run(() => w.deleteChannel(c.id), 'Canal excluído.');
  }

  // ── Diálogo de criação/edição ────────────────────────────
  async function submitDialog(v: EntityValues) {
    if (!dialog) return;
    const base = { name: v.name, icon: v.icon, color: v.color };
    if (dialog.kind === 'space') {
      if (dialog.space) { await w.updateSpace(dialog.space.id, base); toast.success('Espaço atualizado.'); }
      else { const s = await w.createSpace(base); setSpaceId(s.id); setChannelId(null); toast.success('Espaço criado.'); }
    } else if (dialog.kind === 'category') {
      if (dialog.category) { await w.updateCategory(dialog.category.id, base); toast.success('Categoria atualizada.'); }
      else { await w.createCategory(dialog.spaceId, base); toast.success('Categoria criada.'); }
    } else {
      const input = { ...base, topic: v.topic, category_id: v.category_id };
      if (dialog.channel) { await w.updateChannel(dialog.channel.id, input); toast.success('Canal atualizado.'); }
      else { const c = await w.createChannel(dialog.spaceId, input); selectChannel(c.id); toast.success('Canal criado.'); }
    }
  }

  async function logout() {
    await run(() => api('/api/auth/logout', { method: 'POST' }));
    window.location.href = '/login';
  }

  const spaceStyle = space?.color ? ({ '--space': space.color } as React.CSSProperties) : undefined;

  return (
    <div className={`app ${navHidden ? 'nav-hidden' : ''} ${drawer ? 'drawer-open' : ''}`} style={spaceStyle}>
      <div className="drawer-scrim" onClick={() => setDrawer(false)} />
      <div className="nav">
        <SpaceRail
          spaces={w.spaces}
          activeId={spaceId}
          importJob={job}
          onSelect={selectSpace}
          onCreate={() => setDialog({ kind: 'space' })}
          onImport={() => setImportOpen(true)}
          menuFor={spaceMenu}
        />
        {space ? (
          <ChannelSidebar
            space={space}
            categories={w.categoriesOf(space.id)}
            channelsOf={(cat) => w.channelsOf(space.id, cat)}
            activeChannelId={channelId}
            sync={w.sync}
            onRetry={() => run(() => w.refresh(), 'Dados recarregados.')}
            onSelectChannel={selectChannel}
            onToggleCategory={(id) => run(() => w.toggleCategory(id))}
            onCreateChannel={(categoryId) => setDialog({ kind: 'channel', spaceId: space.id, categoryId })}
            onCreateCategory={() => setDialog({ kind: 'category', spaceId: space.id })}
            spaceMenu={spaceMenu(space)}
            categoryMenu={categoryMenu}
            channelMenu={channelMenu}
            onLogout={logout}
            onIdentities={() => setIdentitiesOpen(true)}
          />
        ) : (
          <aside className="sidebar sidebar--blank">
            <div className="sidebar__scroll" />
            <footer className="sidebar__foot">
              <span className="sync sync--ok">ORBE</span>
              <button className="btn btn--sm" onClick={logout}>Sair</button>
            </footer>
          </aside>
        )}
      </div>

      <MainPanel
        space={space}
        category={category}
        channel={channel}
        hasSpaces={w.spaces.length > 0}
        identities={identities}
        activeIdentityId={activeIdentityId}
        onIdentityChange={chooseIdentity}
        onManageIdentities={() => setIdentitiesOpen(true)}
        onImport={() => setImportOpen(true)}
        onToggleSidebar={toggleNav}
        onOpenDrawer={() => setDrawer(true)}
        onCreateSpace={() => setDialog({ kind: 'space' })}
        onCreateChannel={() => space && setDialog({ kind: 'channel', spaceId: space.id, categoryId: null })}
      />

      {identitiesOpen && (
        <IdentitiesDialog onClose={() => setIdentitiesOpen(false)} onChanged={() => { void w.refresh().catch(() => {}); }} />
      )}

      {importOpen && (
        <DiscordImportDialog
          job={job}
          paused={paused}
          onStart={(j) => { setPaused(false); setJob(j); }}
          onPause={() => setPaused(true)}
          onResume={(j) => { if (j.status === 'running') { setPaused(false); setJob(j); } else void jobAction('resume'); }}
          onCancel={() => { if (job?.status === 'running') void jobAction('cancel'); else setJob(null); }}
          onOpenSpace={(id) => { void w.refresh().then(() => selectSpace(id)); }}
          onClose={() => setImportOpen(false)}
        />
      )}

      {dialog && (
        <EntityDialog
          key={JSON.stringify(dialog)}
          kind={dialog.kind}
          title={
            dialog.kind === 'space' ? (dialog.space ? 'Editar espaço' : 'Criar espaço')
              : dialog.kind === 'category' ? (dialog.category ? 'Editar categoria' : 'Criar categoria')
                : dialog.channel ? 'Editar canal' : 'Criar canal'
          }
          submitLabel={(dialog.kind === 'space' && dialog.space) || (dialog.kind === 'category' && dialog.category) || (dialog.kind === 'channel' && dialog.channel) ? 'Salvar' : 'Criar'}
          initial={
            dialog.kind === 'space' ? dialog.space
              : dialog.kind === 'category' ? dialog.category
                : dialog.channel ?? { category_id: dialog.categoryId }
          }
          categories={dialog.kind === 'channel' ? w.categoriesOf(dialog.spaceId) : undefined}
          onSubmit={submitDialog}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
