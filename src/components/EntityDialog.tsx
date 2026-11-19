'use client';

import { useState, type FormEvent } from 'react';
import { Modal } from './ui/Modal';
import { ColorPicker, IconPicker } from './ui/Pickers';
import type { Category } from '@/lib/types';

export interface EntityValues {
  name: string;
  icon: string | null;
  color: string | null;
  topic: string | null;
  category_id: string | null;
  channel_kind: 'chat' | 'page';
  parent_id: string | null;
}

interface Props {
  title: string;
  submitLabel: string;
  kind: 'space' | 'category' | 'channel';
  initial?: Partial<EntityValues>;
  categories?: Category[];
  /** Para categorias: onde ela pode ficar (já sem ela mesma e suas subcategorias), com o rótulo indentado */
  parentOptions?: { id: string; label: string }[];
  onSubmit: (v: EntityValues) => Promise<void>;
  onClose: () => void;
}

const placeholders = { space: 'Ex.: Escrita', category: 'Ex.: Ruptura', channel: 'Ex.: personagens' };

export function EntityDialog({ title, submitLabel, kind, initial, categories, parentOptions, onSubmit, onClose }: Props) {
  const [v, setV] = useState<EntityValues>({
    name: initial?.name ?? '',
    icon: initial?.icon ?? null,
    color: initial?.color ?? null,
    topic: initial?.topic ?? null,
    category_id: initial?.category_id ?? null,
    channel_kind: initial?.channel_kind ?? 'chat',
    parent_id: initial?.parent_id ?? null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof EntityValues>(k: K, val: EntityValues[K]) => setV((s) => ({ ...s, [k]: val }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!v.name.trim()) { setError('Dê um nome.'); return; }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ ...v, name: v.name.trim() });
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={() => { if (!busy) onClose(); }}
      footer={<>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="submit" form="entity-form" className="btn btn--primary" disabled={busy}>
          {busy ? 'Salvando…' : submitLabel}
        </button>
      </>}
    >
      <form id="entity-form" className="form" onSubmit={submit}>
        <div className="preview-row">
          <span className={`preview-badge preview-badge--${kind}`} style={{ '--c': v.color ?? 'var(--accent)' } as React.CSSProperties}>
            {v.icon ?? (kind === 'channel' ? (v.channel_kind === 'page' ? '📄' : '#') : v.name.trim().slice(0, 2).toUpperCase() || '?')}
          </span>
          <label className="field field--grow">
            <span>Nome</span>
            <input className="input" value={v.name} maxLength={100} placeholder={placeholders[kind]}
              onChange={(e) => set('name', e.target.value)} autoFocus />
          </label>
        </div>

        {kind === 'channel' && (
          <div className="field">
            <span>Tipo</span>
            <div className="seg" role="radiogroup" aria-label="Tipo de canal">
              <button type="button" role="radio" aria-checked={v.channel_kind === 'chat'} className={v.channel_kind === 'chat' ? 'is-on' : ''} onClick={() => set('channel_kind', 'chat')}>
                <b># Conversa</b><small>Mensagens, identidades, anexos</small>
              </button>
              <button type="button" role="radio" aria-checked={v.channel_kind === 'page'} className={v.channel_kind === 'page' ? 'is-on' : ''} onClick={() => set('channel_kind', 'page')}>
                <b>📄 Página HTML</b><small>Exibe um documento HTML</small>
              </button>
            </div>
            {initial?.name && initial?.channel_kind && v.channel_kind !== initial.channel_kind && (
              <small className="muted">{v.channel_kind === 'page' ? 'As mensagens do canal ficam guardadas e voltam se ele virar conversa de novo.' : 'O HTML da página fica guardado e volta se ele virar página de novo.'}</small>
            )}
          </div>
        )}

        {kind === 'category' && parentOptions && (
          <label className="field">
            <span>Dentro de</span>
            <select className="input" value={v.parent_id ?? ''} onChange={(e) => set('parent_id', e.target.value || null)}>
              <option value="">Nível principal (nenhuma categoria)</option>
              {parentOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <small className="muted">Escolha uma categoria para usar esta como subcategoria dela — como uma pasta dentro de outra.</small>
          </label>
        )}

        {kind === 'channel' && categories && (
          <label className="field">
            <span>Categoria</span>
            <select className="input" value={v.category_id ?? ''} onChange={(e) => set('category_id', e.target.value || null)}>
              <option value="">Sem categoria</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}

        {kind === 'channel' && (
          <label className="field">
            <span>Descrição <small>(opcional)</small></span>
            <textarea className="input" rows={2} maxLength={1000} value={v.topic ?? ''}
              placeholder="Sobre o que é este canal?" onChange={(e) => set('topic', e.target.value || null)} />
          </label>
        )}

        <div className="field">
          <span>Ícone</span>
          <IconPicker value={v.icon} onChange={(i) => set('icon', i)} />
        </div>

        <div className="field">
          <span>Cor</span>
          <ColorPicker value={v.color} onChange={(c) => set('color', c)} />
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
