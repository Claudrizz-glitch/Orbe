'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { IconAlert, IconCheck, IconClose } from './Icons';

type Kind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: Kind; text: string }

const Ctx = createContext<(kind: Kind, text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  const push = useCallback((kind: Kind, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 3000);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`}>
            {t.kind === 'error' ? <IconAlert size={16} /> : <IconCheck size={16} />}
            <span>{t.text}</span>
            <button className="icon-btn icon-btn--sm" onClick={() => dismiss(t.id)} aria-label="Fechar aviso">
              <IconClose size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const push = useContext(Ctx);
  // Objeto estável: pode ser usado em dependências de hooks sem disparar efeitos a cada render
  return useMemo(() => ({
    success: (t: string) => push('success', t),
    error: (t: string) => push('error', t),
    info: (t: string) => push('info', t),
  }), [push]);
}
