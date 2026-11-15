'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Modal } from './Modal';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** Opções extras (ex.: "manter canais" / "excluir canais"). Se presente, resolve com o value escolhido. */
  choices?: { value: string; label: string; hint?: string }[];
}

type Resolver = (v: string | null) => void;
const Ctx = createContext<(o: ConfirmOptions) => Promise<string | null>>(async () => null);

/** Diálogo de confirmação próprio (substitui window.confirm). Resolve com null se cancelado. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: Resolver } | null>(null);
  const [choice, setChoice] = useState<string>('');

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<string | null>((resolve) => {
    setChoice(opts.choices?.[0]?.value ?? 'ok');
    setState({ opts, resolve });
  }), []);

  const close = (v: string | null) => { state?.resolve(v); setState(null); };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {state && (
        <Modal
          title={state.opts.title}
          onClose={() => close(null)}
          footer={<>
            <button className="btn" onClick={() => close(null)}>Cancelar</button>
            <button className={`btn ${state.opts.danger ? 'btn--danger' : 'btn--primary'}`} onClick={() => close(choice)}>
              {state.opts.confirmLabel ?? 'Confirmar'}
            </button>
          </>}
        >
          <div className="confirm-msg">{state.opts.message}</div>
          {state.opts.choices && (
            <div className="choices" role="radiogroup">
              {state.opts.choices.map((c) => (
                <label key={c.value} className={`choice ${choice === c.value ? 'is-on' : ''}`}>
                  <input type="radio" name="confirm-choice" checked={choice === c.value} onChange={() => setChoice(c.value)} />
                  <span><strong>{c.label}</strong>{c.hint && <small>{c.hint}</small>}</span>
                </label>
              ))}
            </div>
          )}
        </Modal>
      )}
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx);
