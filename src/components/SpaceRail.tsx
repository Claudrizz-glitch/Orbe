'use client';

import type { Space } from '@/lib/types';
import { useContextMenu, type MenuEntry } from './ui/ContextMenu';
import { IconOrbit, IconPlus } from './ui/Icons';

interface Props {
  spaces: Space[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  menuFor: (s: Space) => MenuEntry[];
}

export function initials(name: string) {
  const w = name.trim().split(/\s+/);
  return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
}

export function SpaceRail({ spaces, activeId, onSelect, onCreate, menuFor }: Props) {
  const ctx = useContextMenu();
  return (
    <nav className="rail" aria-label="Espaços">
      <div className="rail__brand" title="ORBE"><IconOrbit size={22} /></div>
      <div className="rail__sep" />
      <ul className="rail__list">
        {spaces.map((s) => (
          <li key={s.id} className={`rail__item ${s.id === activeId ? 'is-active' : ''}`}>
            <button
              className="orb"
              style={{ '--c': s.color ?? 'var(--accent)' } as React.CSSProperties}
              onClick={() => onSelect(s.id)}
              onContextMenu={ctx.onContextMenu(menuFor(s))}
              aria-label={s.name}
              aria-current={s.id === activeId ? 'true' : undefined}
              data-tip={s.name}
            >
              <span className="orb__glyph">{s.icon ?? initials(s.name)}</span>
            </button>
          </li>
        ))}
      </ul>
      <button className="orb orb--add" onClick={onCreate} aria-label="Criar espaço" data-tip="Criar espaço">
        <IconPlus />
      </button>
    </nav>
  );
}
