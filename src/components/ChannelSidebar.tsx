'use client';

import type { Category, Channel, Space } from '@/lib/types';
import type { SyncState } from '@/lib/client/useWorkspace';
import { useContextMenu, type MenuEntry } from './ui/ContextMenu';
import { IconAlert, IconCheck, IconChevron, IconCloudOff, IconFolder, IconHash, IconLogout, IconMore, IconPlus, IconRefresh, IconUsers } from './ui/Icons';

interface Props {
  space: Space;
  categories: Category[];
  channelsOf: (categoryId: string | null) => Channel[];
  activeChannelId: string | null;
  sync: SyncState;
  onRetry: () => void;
  onSelectChannel: (id: string) => void;
  onToggleCategory: (id: string) => void;
  onCreateChannel: (categoryId: string | null) => void;
  onCreateCategory: () => void;
  spaceMenu: MenuEntry[];
  categoryMenu: (c: Category) => MenuEntry[];
  channelMenu: (c: Channel) => MenuEntry[];
  onLogout: () => void;
  onIdentities: () => void;
}

export function ChannelSidebar(p: Props) {
  const ctx = useContextMenu();
  const loose = p.channelsOf(null);
  const empty = loose.length === 0 && p.categories.length === 0;

  const channelRow = (c: Channel) => (
    <li key={c.id}>
      <div
        className={`chan ${c.id === p.activeChannelId ? 'is-active' : ''}`}
        style={{ '--c': c.color ?? 'currentColor' } as React.CSSProperties}
        onContextMenu={ctx.onContextMenu(p.channelMenu(c))}
      >
        <button className="chan__main" onClick={() => p.onSelectChannel(c.id)} aria-current={c.id === p.activeChannelId ? 'page' : undefined}>
          <span className="chan__icon">{c.icon ?? <IconHash size={16} />}</span>
          <span className="chan__name">{c.name}</span>
        </button>
        <button className="icon-btn icon-btn--sm chan__more" onClick={ctx.fromButton(p.channelMenu(c))} aria-label={`Opções de ${c.name}`}>
          <IconMore size={16} />
        </button>
      </div>
    </li>
  );

  return (
    <aside className="sidebar" aria-label={`Canais de ${p.space.name}`}>
      <header className="sidebar__head" style={{ '--c': p.space.color ?? 'var(--accent)' } as React.CSSProperties}
        onContextMenu={ctx.onContextMenu(p.spaceMenu)}>
        <span className="sidebar__dot" />
        <h1 className="sidebar__title">{p.space.name}</h1>
        <button className="icon-btn" onClick={ctx.fromButton(p.spaceMenu)} aria-label="Opções do espaço"><IconMore /></button>
      </header>

      <div className="sidebar__scroll">
        {empty && (
          <div className="sidebar__empty">
            <p>Este espaço ainda está vazio.</p>
            <button className="btn btn--sm btn--primary" onClick={p.onCreateCategory}><IconFolder size={15} /> Nova categoria</button>
            <button className="btn btn--sm" onClick={() => p.onCreateChannel(null)}><IconHash size={15} /> Novo canal</button>
          </div>
        )}

        {loose.length > 0 && <ul className="chan-list">{loose.map(channelRow)}</ul>}

        {p.categories.map((cat) => {
          const chans = p.channelsOf(cat.id);
          return (
            <section key={cat.id} className={`cat ${cat.collapsed ? 'is-collapsed' : ''}`}>
              <div className="cat__head" style={{ '--c': cat.color ?? 'var(--text-muted)' } as React.CSSProperties}
                onContextMenu={ctx.onContextMenu(p.categoryMenu(cat))}>
                <button className="cat__toggle" onClick={() => p.onToggleCategory(cat.id)} aria-expanded={!cat.collapsed}>
                  <IconChevron size={13} className="cat__chev" />
                  {cat.icon && <span className="cat__icon">{cat.icon}</span>}
                  <span className="cat__name">{cat.name}</span>
                </button>
                <button className="icon-btn icon-btn--sm cat__act" onClick={() => p.onCreateChannel(cat.id)} aria-label={`Novo canal em ${cat.name}`}>
                  <IconPlus size={15} />
                </button>
                <button className="icon-btn icon-btn--sm cat__act" onClick={ctx.fromButton(p.categoryMenu(cat))} aria-label={`Opções de ${cat.name}`}>
                  <IconMore size={15} />
                </button>
              </div>
              {!cat.collapsed && (
                chans.length
                  ? <ul className="chan-list">{chans.map(channelRow)}</ul>
                  : <button className="cat__empty" onClick={() => p.onCreateChannel(cat.id)}>+ criar canal</button>
              )}
              {cat.collapsed && chans.some((c) => c.id === p.activeChannelId) && (
                <ul className="chan-list">{chans.filter((c) => c.id === p.activeChannelId).map(channelRow)}</ul>
              )}
            </section>
          );
        })}
      </div>

      <footer className="sidebar__foot">
        <SyncBadge state={p.sync} onRetry={p.onRetry} />
        <span style={{ display: 'flex', gap: 2 }}>
          <button className="icon-btn" onClick={p.onIdentities} aria-label="Identidades" title="Identidades de autoria"><IconUsers size={17} /></button>
          <button className="icon-btn" onClick={p.onLogout} aria-label="Sair" title="Sair"><IconLogout size={17} /></button>
        </span>
      </footer>
    </aside>
  );
}

function SyncBadge({ state, onRetry }: { state: SyncState; onRetry: () => void }) {
  if (state === 'offline') return <span className="sync sync--offline"><IconCloudOff size={15} /> Sem conexão</span>;
  if (state === 'saving') return <span className="sync sync--saving"><span className="spinner" /> Salvando…</span>;
  if (state === 'error') {
    return (
      <button className="sync sync--error" onClick={onRetry} title="Recarregar dados do servidor">
        <IconAlert size={15} /> Falha ao salvar <IconRefresh size={14} />
      </button>
    );
  }
  return <span className="sync sync--ok"><IconCheck size={15} /> Sincronizado</span>;
}
