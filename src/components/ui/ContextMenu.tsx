'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}
export type MenuEntry = MenuItem | 'separator';

type Open = (x: number, y: number, items: MenuEntry[]) => void;
const Ctx = createContext<Open>(() => {});

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const open = useCallback<Open>((x, y, items) => setMenu({ x, y, items }), []);
  const close = () => setMenu(null);

  // Mantém o menu dentro da tela
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onScroll = () => close();
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScroll);
    ref.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onScroll); };
  }, [menu]);

  return (
    <Ctx.Provider value={open}>
      {children}
      {menu && createPortal(
        <div className="ctx-backdrop" onMouseDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }}>
          <div className="ctx-menu" role="menu" ref={ref} style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
            {menu.items.map((it, i) => it === 'separator'
              ? <div key={i} className="ctx-sep" role="separator" />
              : (
                <button key={i} role="menuitem" className={`ctx-item ${it.danger ? 'is-danger' : ''}`} disabled={it.disabled}
                  onClick={() => { close(); it.onSelect(); }}>
                  {it.icon}<span>{it.label}</span>
                </button>
              ))}
          </div>
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

/** Retorna handlers para abrir o menu por clique direito / toque longo ou por botão. */
export function useContextMenu() {
  const open = useContext(Ctx);
  return {
    onContextMenu: (items: MenuEntry[]) => (e: React.MouseEvent) => {
      e.preventDefault(); e.stopPropagation();
      // No celular, segurar o dedo inicia o arraste; o toque longo não deve abrir o menu por cima
      if (document.querySelector('[aria-pressed="true"][aria-roledescription="sortable"]')) return;
      open(e.clientX, e.clientY, items);
    },
    fromButton: (items: MenuEntry[]) => (e: React.MouseEvent) => {
      e.stopPropagation();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      open(r.left, r.bottom + 4, items);
    },
  };
}
