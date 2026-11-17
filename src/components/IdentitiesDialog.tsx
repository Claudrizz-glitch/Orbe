'use client';

import { useEffect, useRef, useState } from 'react';
import { api, apiUpload } from '@/lib/client/api';
import type { Identity, IdentityWithCount } from '@/lib/types';
import { Modal } from './ui/Modal';
import { ColorPicker } from './ui/Pickers';
import { useConfirm } from './ui/ConfirmDialog';
import { useToast } from './ui/Toasts';
import { Avatar } from './MessageList';
import { IconPlus } from './ui/Icons';

interface Props { onClose: () => void; onChanged: () => void }

/** Criar, editar, excluir e mesclar identidades de autoria. */
export function IdentitiesDialog({ onClose, onChanged }: Props) {
  const [list, setList] = useState<IdentityWithCount[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', color: null as string | null });
  const [busy, setBusy] = useState(false);
  const [mergeInto, setMergeInto] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const toast = useToast();

  async function reload(select?: string) {
    try {
      const l = await api<IdentityWithCount[]>('/api/identities');
      setList(l);
      const pick = l.find((i) => i.id === (select ?? sel)) ?? l[0];
      if (pick) choose(pick);
    } catch (e) { toast.error((e as Error).message); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, []);

  function choose(i: Identity) {
    setSel(i.id);
    setForm({ name: i.name, description: i.description ?? '', color: i.color });
    setMergeInto('');
  }

  const cur = list?.find((i) => i.id === sel) ?? null;
  const dirty = !!cur && (form.name !== cur.name || (form.description || null) !== (cur.description || null) || form.color !== cur.color);

  async function run(fn: () => Promise<void>, ok?: string) {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); onChanged(); }
    catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }

  const save = () => cur && run(async () => {
    await api(`/api/identities/${cur.id}`, { method: 'PATCH', body: { name: form.name, description: form.description || null, color: form.color } });
    await reload(cur.id);
  }, 'Identidade salva.');

  const create = () => run(async () => {
    const n = await api<Identity>('/api/identities', { method: 'POST', body: { name: 'Nova identidade' } });
    await reload(n.id);
  }, 'Identidade criada — dê um nome a ela.');

  const upload = (f: File) => cur && run(async () => {
    const fd = new FormData();
    fd.append('file', f);
    await apiUpload(`/api/identities/${cur.id}/avatar`, fd);
    await reload(cur.id);
  }, 'Avatar atualizado.');

  const removeAvatar = () => cur && run(async () => {
    await api(`/api/identities/${cur.id}/avatar`, { method: 'DELETE' });
    await reload(cur.id);
  }, 'Avatar removido.');

  async function remove() {
    if (!cur) return;
    const ok = await confirm({
      title: `Excluir “${cur.name}”?`, danger: true, confirmLabel: 'Excluir identidade',
      message: cur.message_count
        ? <p>As {cur.message_count} mensagens desta identidade serão mantidas, mas ficarão <strong>sem autor</strong>. Para passá-las a outra identidade, use “Mesclar”.</p>
        : <p>Esta identidade não tem mensagens.</p>,
    });
    if (ok) await run(async () => { await api(`/api/identities/${cur.id}`, { method: 'DELETE' }); setSel(null); await reload(); }, 'Identidade excluída.');
  }

  async function merge() {
    if (!cur || !mergeInto) return;
    const target = list?.find((i) => i.id === mergeInto);
    const ok = await confirm({
      title: `Mesclar “${cur.name}” em “${target?.name}”?`, confirmLabel: 'Mesclar',
      message: <p>As {cur.message_count} mensagens de “{cur.name}” passarão a ser de “{target?.name}”, e “{cur.name}” será excluída. Reimportações do Discord também usarão “{target?.name}”.</p>,
    });
    if (ok) await run(async () => { await api(`/api/identities/${cur.id}?reassign_to=${mergeInto}`, { method: 'DELETE' }); await reload(mergeInto); }, 'Identidades mescladas.');
  }

  return (
    <Modal title="Identidades de autoria" onClose={onClose} width={720}>
      <div className="ids">
        <div className="ids__list">
          <button className="btn btn--sm" onClick={create} disabled={busy}><IconPlus size={14} /> Nova identidade</button>
          <ul>
            {list?.map((i) => (
              <li key={i.id}>
                <button className={`ids__item ${i.id === sel ? 'is-on' : ''}`} onClick={() => choose(i)}>
                  <Avatar identity={i} size={28} />
                  <span><b style={{ color: i.color ?? undefined }}>{i.name}</b><small>{i.is_owner ? 'perfil principal · ' : ''}{i.message_count} mensagens</small></span>
                </button>
              </li>
            ))}
            {!list && <li className="muted small">Carregando…</li>}
          </ul>
        </div>

        {cur && (
          <div className="ids__edit form">
            <div className="ids__avatar">
              <Avatar identity={cur} size={72} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
                <button className="btn btn--sm" onClick={() => file.current?.click()} disabled={busy}>Trocar avatar</button>
                {cur.avatar_path && <button className="btn btn--sm btn--ghost" onClick={removeAvatar} disabled={busy}>Remover avatar</button>}
                <small className="muted">PNG, JPG, GIF ou WEBP · até 4 MB</small>
              </div>
            </div>
            <label className="field"><span>Nome</span>
              <input className="input" value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field"><span>Descrição <small>(opcional)</small></span>
              <textarea className="input" rows={3} maxLength={2000} value={form.description} placeholder="Quem é, como fala, em que história aparece…"
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <div className="field"><span>Cor do nome</span><ColorPicker value={form.color} onChange={(c) => setForm({ ...form, color: c })} /></div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn--primary" onClick={save} disabled={!dirty || busy || !form.name.trim()}>Salvar alterações</button>
            </div>

            {!cur.is_owner && (
              <div className="ids__danger">
                <div className="field"><span>Mesclar em outra identidade</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select className="input" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
                      <option value="">Escolha…</option>
                      {list?.filter((i) => i.id !== cur.id).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                    <button className="btn" onClick={merge} disabled={!mergeInto || busy}>Mesclar</button>
                  </div>
                </div>
                <button className="btn btn--danger btn--sm" style={{ alignSelf: 'flex-start' }} onClick={remove} disabled={busy}>Excluir identidade</button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
