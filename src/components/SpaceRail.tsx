'use client';

import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ImportJob, Space } from '@/lib/types';
import { useContextMenu, type MenuEntry } from './ui/ContextMenu';
import { IconDiscord, IconOrbit, IconPlus } from './ui/Icons';
import { fileUrl } from './MessageList';

interface Props {
  spaces: Space[];
  activeId: string | null;
  importJob: ImportJob | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onImport: () => void;
  onReorder: (ids: string[]) => void;
  menuFor: (s: Space) => MenuEntry[];
}

export function initials(name: string) {
  const w = name.trim().split(/\s+/);
  return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
}

function Orb({ s, active, onSelect, menu }: { s: Space; active: boolean; onSelect: () => void; menu: MenuEntry[] }) {
  const ctx = useContextMenu();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id });
  return (
    <li ref={setNodeRef} className={`rail__item ${active ? 'is-active' : ''} ${isDragging ? 'is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}>
      <button
        className={`orb ${s.icon_path ? 'orb--img' : ''}`}
        style={{ '--c': s.color ?? 'var(--accent)' } as React.CSSProperties}
        onClick={onSelect}
        onContextMenu={ctx.onContextMenu(menu)}
        aria-label={s.name}
        aria-current={active ? 'true' : undefined}
        data-tip={s.name}
        {...attributes}
        {...listeners}
      >
        {s.icon_path
          ? <img src={fileUrl(s.icon_path)} alt="" draggable={false} />
          : <span className="orb__glyph">{s.icon ?? initials(s.name)}</span>}
      </button>
    </li>
  );
}

export function SpaceRail({ spaces, activeId, importJob, onSelect, onCreate, onImport, onReorder, menuFor }: Props) {
  const running = importJob?.status === 'running';
  const pct = importJob && importJob.progress.total ? Math.round((importJob.progress.channel / importJob.progress.total) * 100) : 0;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = spaces.map((s) => s.id);
    onReorder(arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))));
  }

  return (
    <nav className="rail" aria-label="Espaços">
      <div className="rail__brand" title="ORBE"><IconOrbit size={20} /></div>
      <div className="rail__sep" />
      <DndContext id="orbe-rail" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={spaces.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="rail__list">
            {spaces.map((s) => (
              <Orb key={s.id} s={s} active={s.id === activeId} onSelect={() => onSelect(s.id)} menu={menuFor(s)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <button className="orb orb--add" onClick={onCreate} aria-label="Criar espaço" data-tip="Criar espaço">
        <IconPlus size={18} />
      </button>
      <button className={`orb orb--tool ${running ? 'is-busy' : ''}`} onClick={onImport} aria-label="Importar do Discord"
        data-tip={running ? `Importando ${importJob!.name}… ${pct}%` : 'Importar do Discord'}
        style={running ? ({ '--p': `${pct}%` } as React.CSSProperties) : undefined}>
        <IconDiscord size={18} />
      </button>
    </nav>
  );
}
