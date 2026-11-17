'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Identity } from '@/lib/types';
import { Avatar } from './MessageList';

interface Props {
  identities: Identity[];
  value: string | null;
  onPick: (id: string) => void;
  onManage?: () => void;
  onClose: () => void;
  /** posição: acima do campo de escrita (padrão) ou em modal */
  inline?: boolean;
}

/** Lista pesquisável de identidades de autoria. */
export function IdentityPicker({ identities, value, onPick, onManage, onClose, inline }: Props) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    const sorted = [...identities].sort((a, b) => Number(b.is_owner) - Number(a.is_owner) || a.name.localeCompare(b.name, 'pt-BR'));
    return n ? sorted.filter((i) => i.name.toLowerCase().includes(n)) : sorted;
  }, [identities, q]);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => {
    if (inline) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [inline, onClose]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    if (e.key === 'Enter' && list[hi]) { e.preventDefault(); onPick(list[hi].id); }
  }

  return (
    <div className={`idpick ${inline ? 'idpick--inline' : ''}`} ref={box} onKeyDown={onKey}>
      <input ref={input} className="input input--sm" placeholder="Buscar identidade…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="idpick__list" role="listbox">
        {list.map((i, n) => (
          <li key={i.id}>
            <button role="option" aria-selected={i.id === value} className={`idpick__item ${n === hi ? 'is-hi' : ''} ${i.id === value ? 'is-on' : ''}`}
              onMouseEnter={() => setHi(n)} onClick={() => onPick(i.id)}>
              <Avatar identity={i} size={24} />
              <span style={{ color: i.color ?? undefined }}>{i.name}</span>
              {i.is_owner && <small>você</small>}
            </button>
          </li>
        ))}
        {!list.length && <li className="muted small" style={{ padding: '8px 10px' }}>Nenhuma identidade encontrada.</li>}
      </ul>
      {onManage && <button className="idpick__manage" onClick={onManage}>Gerenciar identidades…</button>}
    </div>
  );
}
