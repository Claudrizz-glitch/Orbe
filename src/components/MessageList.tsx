'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/client/api';
import { plainText, renderMarkdown } from '@/lib/markdown';
import type { Attachment, Channel, Identity, Message, MessagePage, ReplyPreview } from '@/lib/types';
import { IconAlert, IconHash, IconRefresh } from './ui/Icons';

interface Props {
  channel: Channel;
  identities: Map<string, Identity>;
}

const GROUP_MS = 7 * 60 * 1000;
const fmtTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtFull = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
const dayKey = (iso: string) => iso.slice(0, 10);

export const fileUrl = (path: string) => `/api/files/${path.split('/').map(encodeURIComponent).join('/')}`;

function initials(name: string) {
  const w = name.trim().split(/\s+/);
  return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
}

export function Avatar({ identity, size }: { identity: Identity | undefined; size?: number }) {
  const style = size ? { width: size, height: size } : undefined;
  if (identity?.avatar_path) return <img className="msg__avatar" src={fileUrl(identity.avatar_path)} alt="" loading="lazy" style={style} />;
  return (
    <div className="msg__avatar" style={{ ...style, color: identity?.color ?? undefined }}>
      {initials(identity?.name ?? '?')}
    </div>
  );
}

function humanSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

function AttachmentView({ a }: { a: Attachment }) {
  const url = fileUrl(a.storage_path);
  if (a.mime_type.startsWith('image/') && !a.mime_type.includes('svg')) {
    return <a href={url} target="_blank" rel="noreferrer"><img className="att-img" src={url} alt={a.file_name} loading="lazy" width={a.width ?? undefined} height={a.height ?? undefined} /></a>;
  }
  if (a.mime_type.startsWith('video/')) return <video className="att-img" src={url} controls preload="metadata" />;
  if (a.mime_type.startsWith('audio/')) return <audio src={url} controls preload="none" />;
  const ext = a.file_name.includes('.') ? a.file_name.split('.').pop()!.slice(0, 4) : 'arq';
  return (
    <a className="att-file" href={`${url}?download=${encodeURIComponent(a.file_name)}`}>
      <span className="att-file__ext">{ext}</span>
      <span>{a.file_name}<small>{humanSize(a.size_bytes)}</small></span>
    </a>
  );
}

export function MessageList({ channel, identities }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [atts, setAtts] = useState<Map<string, Attachment[]>>(new Map());
  const [replies, setReplies] = useState<Map<string, ReplyPreview>>(new Map());
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const first = useRef(true);

  const merge = useCallback((page: MessagePage, older: boolean) => {
    setMessages((m) => (older ? [...page.messages, ...m] : page.messages));
    setAtts((prev) => {
      const next = new Map(older ? prev : []);
      for (const a of page.attachments) next.set(a.message_id, [...(next.get(a.message_id) ?? []), a]);
      return next;
    });
    setReplies((prev) => {
      const next = new Map(older ? prev : []);
      for (const r of page.replies) next.set(r.id, r);
      return next;
    });
    setHasMore(page.has_more);
  }, []);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError(null);
    try {
      if (offset && scroller.current) anchor.current = { height: scroller.current.scrollHeight, top: scroller.current.scrollTop };
      merge(await api<MessagePage>(`/api/channels/${channel.id}/messages?offset=${offset}&limit=100`), offset > 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [channel.id, merge]);

  useEffect(() => { first.current = true; void load(0); }, [load]);

  // Rolagem: fim do canal ao abrir; posição preservada ao carregar anteriores
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (anchor.current) {
      el.scrollTop = el.scrollHeight - anchor.current.height + anchor.current.top;
      anchor.current = null;
    } else if (first.current && messages.length) {
      el.scrollTop = el.scrollHeight;
      first.current = false;
    }
  }, [messages]);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  function jumpTo(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
  }

  if (error && !messages.length) {
    return (
      <div className="main__body"><div className="empty">
        <IconAlert size={28} />
        <h3>Não foi possível carregar</h3>
        <p>{error}</p>
        <button className="btn" onClick={() => load(0)}><IconRefresh size={15} /> Tentar novamente</button>
      </div></div>
    );
  }

  if (!loading && !messages.length) {
    return (
      <div className="main__body"><div className="empty">
        <div className="empty__chan" style={{ color: channel.color ?? undefined }}>{channel.icon ?? <IconHash size={30} />}</div>
        <h3>#{channel.name}</h3>
        <p>Este é o começo do canal.</p>
        <p className="soon-note">Escrever e editar mensagens chega na <strong>Fase 2</strong>.</p>
      </div></div>
    );
  }

  let prev: Message | null = null;
  return (
    <div className="main__body" ref={scroller}>
      <div className="msgs">
        {hasMore
          ? <button className="btn btn--sm msgs__more" onClick={() => load(messages.length)} disabled={loading}>{loading ? 'Carregando…' : 'Carregar mensagens anteriores'}</button>
          : messages.length > 0 && (
            <div className="msgs__start">
              <h3>#{channel.name}</h3>
              <p>{channel.topic ?? 'Início do canal.'}</p>
            </div>
          )}
        {messages.map((m) => {
          const idn = m.identity_id ? identities.get(m.identity_id) : undefined;
          const newDay = !prev || dayKey(prev.display_at) !== dayKey(m.display_at);
          const cont = !!prev && !newDay && !m.reply_to_id && prev.identity_id === m.identity_id
            && Math.abs(new Date(m.display_at).getTime() - new Date(prev.display_at).getTime()) < GROUP_MS;
          prev = m;
          const reply = m.reply_to_id ? byId.get(m.reply_to_id) ?? replies.get(m.reply_to_id) : undefined;
          const replyIdn = reply?.identity_id ? identities.get(reply.identity_id) : undefined;
          const d = new Date(m.display_at);
          return (
            <div key={m.id}>
              {newDay && <div className="day-sep">{fmtDay.format(d)}</div>}
              <article id={`msg-${m.id}`} className={`msg ${cont ? 'msg--cont' : ''} ${m.reply_to_id ? 'msg--reply' : ''}`} style={{ '--idc': idn?.color ?? 'var(--text)' } as React.CSSProperties}>
                {m.reply_to_id && (
                  <button className="msg__reply" onClick={() => jumpTo(m.reply_to_id!)} title="Ir para a mensagem original">
                    {reply ? <><b>{replyIdn?.name ?? 'Desconhecido'}</b><span>{plainText(reply.content) || 'anexo'}</span></> : <span>Mensagem original indisponível</span>}
                  </button>
                )}
                {cont
                  ? <div className="msg__gutter" title={fmtFull.format(d)}>{fmtTime.format(d)}</div>
                  : <Avatar identity={idn} />}
                <div className="msg__body">
                  {!cont && (
                    <div className="msg__head">
                      <span className="msg__author">{idn?.name ?? 'Autor removido'}</span>
                      <time className="msg__time" dateTime={m.display_at} title={fmtFull.format(d)}>{fmtFull.format(d)}</time>
                      {m.pinned_at && <span className="msg__pin" title="Fixada">● fixada</span>}
                    </div>
                  )}
                  {m.content && <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />}
                  {m.extra?.embeds?.map((e, i) => (
                    <div key={i} className="embed" style={{ '--ec': e.color ? `#${e.color.toString(16).padStart(6, '0')}` : undefined } as React.CSSProperties}>
                      {e.author && <small className="muted">{e.author}</small>}
                      {e.title && (e.url ? <a href={e.url} target="_blank" rel="noreferrer nofollow"><b>{e.title}</b></a> : <b>{e.title}</b>)}
                      {e.description && <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(e.description) }} />}
                      {e.footer && <small className="muted">{e.footer}</small>}
                    </div>
                  ))}
                  {atts.get(m.id) && <div className="atts">{atts.get(m.id)!.map((a) => <AttachmentView key={a.id} a={a} />)}</div>}
                </div>
              </article>
            </div>
          );
        })}
      </div>
    </div>
  );
}
