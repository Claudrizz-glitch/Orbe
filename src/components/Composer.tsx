'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Channel, Identity } from '@/lib/types';
import { MAX_FILE, humanSize } from '@/lib/client/upload';
import { MarkdownEditor, type EditorHandle } from './MarkdownEditor';
import { IdentityPicker } from './IdentityPicker';
import { Avatar } from './MessageList';
import { IconChevron, IconPaperclip } from './ui/Icons';
import { useToast } from './ui/Toasts';

interface Props {
  channel: Channel;
  identities: Identity[];
  activeIdentityId: string | null;
  onIdentityChange: (id: string) => void;
  onManageIdentities: () => void;
  onSend: (content: string, files: File[]) => void;
  replyTo: { name: string; text: string } | null;
  onCancelReply: () => void;
}

const draftKey = (id: string) => `orbe:draft:${id}`;
const MAX_FILES = 10;

/** Miniatura de um arquivo escolhido (imagens mostram a prévia). */
function FileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const url = useMemo(() => (file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.slice(0, 4) : 'arq';
  return (
    <div className="fchip" title={`${file.name} · ${humanSize(file.size)}`}>
      {url ? <img src={url} alt="" /> : <span className="fchip__ext">{ext}</span>}
      <span className="fchip__name">{file.name}<small>{humanSize(file.size)}</small></span>
      <button type="button" className="fchip__x" onClick={onRemove} aria-label={`Remover ${file.name}`}>×</button>
    </div>
  );
}

export function Composer({ channel, identities, activeIdentityId, onIdentityChange, onManageIdentities, onSend, replyTo, onCancelReply }: Props) {
  // Rascunho guardado neste dispositivo enquanto não é enviado
  const [text, setText] = useState(() => {
    try { return localStorage.getItem(draftKey(channel.id)) ?? ''; } catch { return ''; }
  });
  const [files, setFiles] = useState<File[]>([]);
  const [picking, setPicking] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const editor = useRef<EditorHandle>(null);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const active = identities.find((i) => i.id === activeIdentityId) ?? identities.find((i) => i.is_owner);

  useEffect(() => {
    const t = setTimeout(() => {
      try { if (text) localStorage.setItem(draftKey(channel.id), text); else localStorage.removeItem(draftKey(channel.id)); } catch { /* sem armazenamento */ }
    }, 300);
    return () => clearTimeout(t);
  }, [text, channel.id]);

  function addFiles(list: File[]) {
    const ok: File[] = [];
    for (const f of list) {
      if (f.size > MAX_FILE) { toast.error(`“${f.name}” passa de 25 MB e não foi anexado.`); continue; }
      if (!f.size) { toast.error(`“${f.name}” está vazio.`); continue; }
      ok.push(f);
    }
    setFiles((cur) => {
      const next = [...cur, ...ok];
      if (next.length > MAX_FILES) toast.error(`No máximo ${MAX_FILES} arquivos por mensagem.`);
      return next.slice(0, MAX_FILES);
    });
    editor.current?.focus();
  }

  function send() {
    if (!text.trim() && !files.length) return;
    onSend(text, files);
    setText('');
    setFiles([]);
    try { localStorage.removeItem(draftKey(channel.id)); } catch { /* ignore */ }
    editor.current?.focus();
  }

  // Ao escolher "Responder", o foco vai para o campo de escrita
  useEffect(() => { if (replyTo) editor.current?.focus(); }, [replyTo]);

  return (
    <div className={`composer ${dragOver ? 'is-dragover' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragOver(false); addFiles([...e.dataTransfer.files]); } }}>
      {replyTo && (
        <div className="replying">
          <span>Respondendo a <b>{replyTo.name}</b>: <span className="replying__text">{replyTo.text || 'anexo'}</span></span>
          <button className="icon-btn icon-btn--sm" onClick={onCancelReply} aria-label="Cancelar resposta" title="Cancelar resposta (Esc)">×</button>
        </div>
      )}
      {files.length > 0 && (
        <div className="fchips">{files.map((f, i) => <FileChip key={`${f.name}-${i}`} file={f} onRemove={() => setFiles((l) => l.filter((_, j) => j !== i))} />)}</div>
      )}
      {picking && (
        <IdentityPicker
          identities={identities}
          value={active?.id ?? null}
          onPick={(id) => { onIdentityChange(id); setPicking(false); editor.current?.focus(); }}
          onManage={() => { setPicking(false); onManageIdentities(); }}
          onClose={() => setPicking(false)}
        />
      )}
      <input ref={input} type="file" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      <MarkdownEditor
        ref={editor}
        value={text}
        onChange={setText}
        onSubmit={send}
        onCancel={replyTo ? onCancelReply : undefined}
        onPasteFiles={addFiles}
        placeholder={`Escrever em #${channel.name} como ${active?.name ?? '…'}`}
        leading={
          <button type="button" className="who" onClick={() => setPicking((p) => !p)} title="Escolher quem está falando"
            style={{ '--idc': active?.color ?? 'var(--text)' } as React.CSSProperties}>
            <Avatar identity={active} size={22} />
            <span>{active?.name ?? 'Identidade'}</span>
            <IconChevron size={12} />
          </button>
        }
        trailing={
          <>
            <button type="button" className="tool attach" onClick={() => input.current?.click()} aria-label="Anexar arquivos" title="Anexar arquivos (ou arraste/cole aqui)">
              <IconPaperclip size={16} />
            </button>
            <button type="button" className="send" onClick={send} disabled={!text.trim() && !files.length} aria-label="Enviar mensagem" title="Enviar (Enter)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </>
        }
      />
      {dragOver && <div className="dropmask">Solte os arquivos para anexar</div>}
      <div className="composer__hint">Enter envia · Shift+Enter quebra linha · Ctrl+B/I/U formata · arraste ou cole arquivos para anexar</div>
    </div>
  );
}
