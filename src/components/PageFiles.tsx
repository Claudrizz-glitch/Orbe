'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client/api';
import { humanSize, uploadAttachment } from '@/lib/client/upload';
import type { Attachment } from '@/lib/types';
import { Modal } from './ui/Modal';
import { useConfirm } from './ui/ConfirmDialog';
import { useToast } from './ui/Toasts';
import { IconPaperclip, IconTrash } from './ui/Icons';

export interface PageFilesList { message_id: string | null; files: Attachment[] }

export const loadPageFiles = (channelId: string) => api<PageFilesList>(`/api/channels/${channelId}/page/files`);

/** Arquivos que uma página HTML pode abrir (PDFs, imagens, documentos). */
export function PageFiles({ channelId, onClose, onOpen, onChanged }: {
  channelId: string; onClose: () => void; onOpen: (a: Attachment) => void; onChanged: () => void;
}) {
  const [list, setList] = useState<Attachment[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const confirm = useConfirm();

  async function reload() {
    try { setList((await loadPageFiles(channelId)).files); }
    catch (e) { toast.error((e as Error).message); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [channelId]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    try {
      const { message_id } = await api<{ message_id: string }>(`/api/channels/${channelId}/page/files`, { method: 'POST' });
      const all = [...files];
      for (let i = 0; i < all.length; i++) {
        const f = all[i];
        await uploadAttachment(message_id, f, (p) => setBusy(`Enviando ${i + 1}/${all.length} · ${Math.round(p * 100)}%`));
      }
      toast.success(all.length === 1 ? 'Arquivo enviado.' : `${all.length} arquivos enviados.`);
      await reload();
      onChanged();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(null);
  }

  async function remove(a: Attachment) {
    const ok = await confirm({
      title: `Remover “${a.file_name}”?`, danger: true, confirmLabel: 'Remover',
      message: <p className="muted">O arquivo sai da página e fica guardado em <b>LOG › #log</b> para recuperação.</p>,
    });
    if (!ok) return;
    try {
      await api(`/api/attachments/${a.id}`, { method: 'DELETE' });
      await reload();
      onChanged();
    } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <Modal title="Arquivos da página" onClose={onClose} width={640}
      footer={<>
        <span className="muted small" style={{ marginRight: 'auto' }}>{busy ?? 'A página pode listar e abrir estes arquivos.'}</span>
        <input ref={input} type="file" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
        <button className="btn btn--primary" disabled={!!busy} onClick={() => input.current?.click()}><IconPaperclip size={15} /> Enviar arquivos</button>
      </>}>
      {!list && <p className="muted">Carregando…</p>}
      {list && !list.length && <p className="muted">Nenhum arquivo ainda. Envie PDFs, imagens ou documentos que a página deve abrir.</p>}
      {list && list.length > 0 && (
        <ul className="pfiles">
          {list.map((a) => (
            <li key={a.id}>
              <button className="pfiles__open" onClick={() => onOpen(a)} title="Abrir no ORBE">
                <b>{a.file_name}</b><small>{humanSize(a.size_bytes)}</small>
              </button>
              <button className="icon-btn" onClick={() => remove(a)} title="Remover"><IconTrash size={15} /></button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
