'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Category, Channel, Space } from '@/lib/types';
import type { SyncState } from '@/lib/client/useWorkspace';
import { useContextMenu, type MenuEntry } from './ui/ContextMenu';
import { IconAlert, IconCheck, IconChevron, IconCloudOff, IconFolder, IconHash, IconLogout, IconMore, IconPage, IconPlus, IconRefresh, IconUsers } from './ui/Icons';

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
  onReorderCategories: (ids: string[]) => void;
  onReorderChannels: (ids: string[]) => void;
  onMoveChannel: (channelId: string, categoryId: string | null, ids: string[]) => void;
}

const ROOT = 'root';
const CAT = 'cat:';
const ZONE = 'zone:';

// ── Linha de canal (arrastável) ──────────────────────────────
function ChannelRow({ c, active, menu, onSelect, sortable = true }: { c: Channel; active: boolean; menu: MenuEntry[]; onSelect: () => void; sortable?: boolean }) {
  const ctx = useContextMenu();
  const s = useSortable({ id: c.id, data: { type: 'channel' }, disabled: !sortable });
  return (
    <li ref={s.setNodeRef} style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition }} className={s.isDragging ? 'is-dragging' : undefined}>
      <div className={`chan ${active ? 'is-active' : ''}`} style={{ '--c': c.color ?? 'currentColor' } as React.CSSProperties}
        onContextMenu={ctx.onContextMenu(menu)}>
        <button className="chan__main" onClick={onSelect} aria-current={active ? 'page' : undefined} {...s.attributes} {...s.listeners}>
          <span className="chan__icon">{c.icon ?? (c.kind === 'page' ? <IconPage size={16} /> : <IconHash size={16} />)}</span>
          <span className="chan__name">{c.name}</span>
        </button>
        <button className="icon-btn icon-btn--sm chan__more" onClick={ctx.fromButton(menu)} aria-label={`Opções de ${c.name}`}>
          <IconMore size={16} />
        </button>
      </div>
    </li>
  );
}

// ── Área que aceita canais (para listas vazias / fora de categorias) ──
function Zone({ id, children, className }: { id: string; children?: React.ReactNode; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: ZONE + id, data: { type: 'zone', container: id } });
  return <div ref={setNodeRef} className={`${className ?? ''} ${isOver ? 'is-over' : ''}`}>{children}</div>;
}

// ── Cabeçalho de categoria (arrastável; aceita canais soltos sobre ele) ──
function CategorySection(props: {
  cat: Category; menu: MenuEntry[]; onToggle: () => void; onCreate: () => void; children: React.ReactNode; dropTarget: boolean;
}) {
  const { cat } = props;
  const ctx = useContextMenu();
  const s = useSortable({ id: CAT + cat.id, data: { type: 'category', container: cat.id } });
  return (
    <section ref={s.setNodeRef} style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition }}
      className={`cat ${cat.collapsed ? 'is-collapsed' : ''} ${s.isDragging ? 'is-dragging' : ''} ${props.dropTarget ? 'is-drop' : ''}`}>
      <div className="cat__head" style={{ '--c': cat.color ?? 'var(--text-muted)' } as React.CSSProperties}
        onContextMenu={ctx.onContextMenu(props.menu)}>
        <button className="cat__toggle" onClick={props.onToggle} aria-expanded={!cat.collapsed} {...s.attributes} {...s.listeners}>
          <IconChevron size={13} className="cat__chev" />
          {cat.icon && <span className="cat__icon">{cat.icon}</span>}
          <span className="cat__name">{cat.name}</span>
        </button>
        <button className="icon-btn icon-btn--sm cat__act" onClick={props.onCreate} aria-label={`Novo canal em ${cat.name}`}>
          <IconPlus size={15} />
        </button>
        <button className="icon-btn icon-btn--sm cat__act" onClick={ctx.fromButton(props.menu)} aria-label={`Opções de ${cat.name}`}>
          <IconMore size={15} />
        </button>
      </div>
      {props.children}
    </section>
  );
}

export function ChannelSidebar(p: Props) {
  const ctx = useContextMenu();
  const byId = useMemo(() => {
    const m = new Map<string, Channel>();
    for (const c of p.channelsOf(null)) m.set(c.id, c);
    for (const cat of p.categories) for (const c of p.channelsOf(cat.id)) m.set(c.id, c);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.categories, p.channelsOf]);

  // Layout local (container → ids) para o arraste fluido entre categorias
  const fromProps = () => {
    const l: Record<string, string[]> = { [ROOT]: p.channelsOf(null).map((c) => c.id) };
    for (const cat of p.categories) l[cat.id] = p.channelsOf(cat.id).map((c) => c.id);
    return l;
  };
  const [layout, setLayout] = useState<Record<string, string[]>>(fromProps);
  const [dragging, setDragging] = useState<{ id: string; type: 'channel' | 'category'; from: string } | null>(null);
  const [overCat, setOverCat] = useState<string | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!dragging) setLayout(fromProps()); }, [byId, p.categories, dragging]);

  const containerOf = (id: string): string | null => {
    if (id.startsWith(CAT)) return id.slice(CAT.length);
    if (id.startsWith(ZONE)) return id.slice(ZONE.length);
    return Object.keys(layoutRef.current).find((k) => layoutRef.current[k].includes(id)) ?? null;
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Categorias só colidem com categorias; canais colidem com canais, zonas e cabeçalhos
  const collision: CollisionDetection = (args) => {
    const type = args.active.data.current?.type;
    const droppableContainers = args.droppableContainers.filter((c) =>
      type === 'category' ? c.data.current?.type === 'category' : true);
    return closestCenter({ ...args, droppableContainers });
  };

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    const type = e.active.data.current?.type === 'category' ? 'category' : 'channel';
    setDragging({ id, type, from: type === 'channel' ? containerOf(id) ?? ROOT : '' });
  }

  function onDragOver(e: DragOverEvent) {
    if (!dragging || dragging.type !== 'channel' || !e.over) { setOverCat(null); return; }
    const activeId = String(e.active.id);
    const overId = String(e.over.id);
    const from = containerOf(activeId);
    const to = containerOf(overId);
    setOverCat(overId.startsWith(CAT) ? to : null);
    if (!from || !to || from === to) return;
    setLayout((l) => {
      const src = l[from].filter((x) => x !== activeId);
      const dst = [...(l[to] ?? [])];
      const idx = overId.startsWith(CAT) || overId.startsWith(ZONE) ? dst.length : Math.max(0, dst.indexOf(overId));
      dst.splice(idx, 0, activeId);
      return { ...l, [from]: src, [to]: dst };
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const d = dragging;
    setDragging(null);
    setOverCat(null);
    if (!d) return;
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;

    if (d.type === 'category') {
      if (!overId || overId === activeId) return;
      const ids = p.categories.map((c) => CAT + c.id);
      const next = arrayMove(ids, ids.indexOf(activeId), ids.indexOf(overId)).map((x) => x.slice(CAT.length));
      p.onReorderCategories(next);
      return;
    }

    const container = containerOf(activeId) ?? d.from;
    let ids = [...(layoutRef.current[container] ?? [])];
    if (overId && !overId.startsWith(CAT) && !overId.startsWith(ZONE) && ids.includes(overId)) {
      ids = arrayMove(ids, ids.indexOf(activeId), ids.indexOf(overId));
    }
    setLayout((l) => ({ ...l, [container]: ids }));
    if (container !== d.from) {
      p.onMoveChannel(activeId, container === ROOT ? null : container, ids);
    } else {
      const before = d.from === ROOT ? p.channelsOf(null).map((c) => c.id) : p.channelsOf(d.from).map((c) => c.id);
      if (ids.join() !== before.join()) p.onReorderChannels(ids);
    }
  }

  const row = (id: string, sortable = true) => {
    const c = byId.get(id);
    if (!c) return null;
    return <ChannelRow key={id} c={c} active={id === p.activeChannelId} menu={p.channelMenu(c)} onSelect={() => p.onSelectChannel(id)} sortable={sortable} />;
  };

  const loose = layout[ROOT] ?? [];
  const empty = loose.length === 0 && p.categories.length === 0;
  const draggingChannel = dragging?.type === 'channel';
  const overlayChannel = draggingChannel ? byId.get(dragging!.id) : null;

  return (
    <aside className={`sidebar ${dragging ? 'is-sorting' : ''}`} aria-label={`Canais de ${p.space.name}`}>
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

        <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}
          onDragCancel={() => { setDragging(null); setOverCat(null); }}>
          <SortableContext items={loose} strategy={verticalListSortingStrategy}>
            {(loose.length > 0 || draggingChannel) && (
              <Zone id={ROOT} className="chan-zone">
                <ul className="chan-list">{loose.map((id) => row(id))}</ul>
                {draggingChannel && !loose.length && <div className="zone-hint">Solte aqui para tirar da categoria</div>}
              </Zone>
            )}
          </SortableContext>

          <SortableContext items={p.categories.map((c) => CAT + c.id)} strategy={verticalListSortingStrategy}>
            {p.categories.map((cat) => {
              const ids = layout[cat.id] ?? [];
              return (
                <CategorySection key={cat.id} cat={cat} menu={p.categoryMenu(cat)} dropTarget={overCat === cat.id && draggingChannel}
                  onToggle={() => p.onToggleCategory(cat.id)} onCreate={() => p.onCreateChannel(cat.id)}>
                  {!cat.collapsed && dragging?.type !== 'category' && (
                    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                      <Zone id={cat.id} className="chan-zone">
                        {ids.length
                          ? <ul className="chan-list">{ids.map((id) => row(id))}</ul>
                          : <button className="cat__empty" onClick={() => p.onCreateChannel(cat.id)}>{draggingChannel ? 'Solte aqui' : '+ criar canal'}</button>}
                      </Zone>
                    </SortableContext>
                  )}
                  {cat.collapsed && ids.includes(p.activeChannelId ?? '') && (
                    <ul className="chan-list">{row(p.activeChannelId!, false)}</ul>
                  )}
                </CategorySection>
              );
            })}
          </SortableContext>

          <DragOverlay dropAnimation={null}>
            {overlayChannel && (
              <div className="chan is-overlay"><span className="chan__main"><span className="chan__icon">{overlayChannel.icon ?? <IconHash size={16} />}</span><span className="chan__name">{overlayChannel.name}</span></span></div>
            )}
          </DragOverlay>
        </DndContext>
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
