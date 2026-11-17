'use client';

import { useEffect, useRef, useState } from 'react';
import type { Channel, Identity } from '@/lib/types';
import { MarkdownEditor, type EditorHandle } from './MarkdownEditor';
import { IdentityPicker } from './IdentityPicker';
import { Avatar } from './MessageList';
import { IconChevron } from './ui/Icons';

interface Props {
  channel: Channel;
  identities: Identity[];
  activeIdentityId: string | null;
  onIdentityChange: (id: string) => void;
  onManageIdentities: () => void;
  onSend: (content: string) => void;
  replyTo: { name: string; text: string } | null;
  onCancelReply: () => void;
}

const draftKey = (id: string) => `orbe:draft:${id}`;

export function Composer({ channel, identities, activeIdentityId, onIdentityChange, onManageIdentities, onSend, replyTo, onCancelReply }: Props) {
  // Rascunho guardado neste dispositivo enquanto não é enviado
  const [text, setText] = useState(() => {
    try { return localStorage.getItem(draftKey(channel.id)) ?? ''; } catch { return ''; }
  });
  const [picking, setPicking] = useState(false);
  const editor = useRef<EditorHandle>(null);
  const active = identities.find((i) => i.id === activeIdentityId) ?? identities.find((i) => i.is_owner);

  useEffect(() => {
    const t = setTimeout(() => {
      try { if (text) localStorage.setItem(draftKey(channel.id), text); else localStorage.removeItem(draftKey(channel.id)); } catch { /* sem armazenamento */ }
    }, 300);
    return () => clearTimeout(t);
  }, [text, channel.id]);

  function send() {
    if (!text.trim()) return;
    onSend(text);
    setText('');
    try { localStorage.removeItem(draftKey(channel.id)); } catch { /* ignore */ }
    editor.current?.focus();
  }

  // Ao escolher "Responder", o foco vai para o campo de escrita
  useEffect(() => { if (replyTo) editor.current?.focus(); }, [replyTo]);

  return (
    <div className="composer">
      {replyTo && (
        <div className="replying">
          <span>Respondendo a <b>{replyTo.name}</b>: <span className="replying__text">{replyTo.text || 'anexo'}</span></span>
          <button className="icon-btn icon-btn--sm" onClick={onCancelReply} aria-label="Cancelar resposta" title="Cancelar resposta (Esc)">×</button>
        </div>
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
      <MarkdownEditor
        ref={editor}
        value={text}
        onChange={setText}
        onSubmit={send}
        onCancel={replyTo ? onCancelReply : undefined}
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
          <button type="button" className="send" onClick={send} disabled={!text.trim()} aria-label="Enviar mensagem" title="Enviar (Enter)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        }
      />
      <div className="composer__hint">Enter envia · Shift+Enter quebra linha · Ctrl+B/I/U formata</div>
    </div>
  );
}
