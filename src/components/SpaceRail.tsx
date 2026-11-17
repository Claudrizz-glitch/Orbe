'use client';

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
  menuFor: (s: Space) => MenuEntry[];
}

export function initials(name: string) {
  const w = name.trim().split(/\s+/);
  return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
}

export function SpaceRail({ spaces, activeId, importJob, onSelect, onCreate, onImport, menuFor }: Props) {
  const ctx = useContextMenu();
  const running = importJob?.status === 'running';
  const pct = importJob && importJob.progress.total ? Math.round((importJob.progress.channel / importJob.progress.total) * 100) : 0;
  return (
    <nav className="rail" aria-label="Espaços">
      <div className="rail__brand" title="ORBE"><IconOrbit size={20} /></div>
      <div className="rail__sep" />
      <ul className="rail__list">
        {spaces.map((s) => (
          <li key={s.id} className={`rail__item ${s.id === activeId ? 'is-active' : ''}`}>
            <button
              className={`orb ${s.icon_path ? 'orb--img' : ''}`}
              style={{ '--c': s.color ?? 'var(--accent)' } as React.CSSProperties}
              onClick={() => onSelect(s.id)}
              onContextMenu={ctx.onContextMenu(menuFor(s))}
              aria-label={s.name}
              aria-current={s.id === activeId ? 'true' : undefined}
              data-tip={s.name}
            >
              {s.icon_path
                ? <img src={fileUrl(s.icon_path)} alt="" />
                : <span className="orb__glyph">{s.icon ?? initials(s.name)}</span>}
            </button>
          </li>
        ))}
      </ul>
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
