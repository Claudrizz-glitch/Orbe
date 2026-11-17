'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/client/api';
import { plainText, renderMarkdown } from '@/lib/markdown';
import type { Attachment, Channel, Identity, Message, MessagePage, ReplyPreview } from '@/lib/types';
import { IconAlert, IconEdit, IconHash, IconMore, IconRefresh, IconTrash } from './ui/Icons';
import { useContextMenu, type MenuEntry } from './ui/ContextMenu';
import { useConfirm } from './ui/ConfirmDialog';
import { useToast } from './ui/Toasts';
import { Modal } from './ui/Modal';
import { MarkdownEditor } from './MarkdownEditor';
import { Composer } from './Composer';
import { IdentityPicker } from './IdentityPicker';

interface Props {
  channel: Channel;
  identities: Map<string, Identity>;
  activeIdentityId: string | null;
  onIdentityChange: (id: string) => void;
  onManageIdentities: () => void;
}

/** Mensagem local ainda não confirmada pelo servidor */
interface Pending { tmp: string; content: string; identity_id: string | null; display_at: string; status: 'sending' | 'failed'; error?: string }

const GROUP_MS = 7 * 60 * 1000;
const fmtTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtFull = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtLong = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'medium' });
const fmtDay = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

export const fileUrl = (path: string) => `/api/files/${path.split('/').map(encodeURIComponent).join('/')}`;

function initials(name: string) {
  const w = name.trim().split(/\s+/);
  return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
}

export function Avatar({ identity, size }: { identity: Identity | undefined; size?: number }) {
  const style = size ? { width: size, height: size, fontSize: Math.max(9, size * 0.36), marginTop: 0 } : undefined;
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

/** Coloca o marcador "(editada)" no fim do último parágrafo, quando houver. */
function withEdited(html: string, editedAt: string | null) {
  if (!editedAt) return html;
  const tag = `<span class="edited" title="Editada em ${fmtLong.format(new Date(editedAt))}">(editada)</span>`;
  return html.endsWith('</p>') ? `${html.slice(0, -4)}${tag}</p>` : html + tag;
}

function sortMessages(list: Message[], mode: Channel['sort_mode']) {
  return [...list].sort((a, b) => mode === 'chronological'
    ? a.display_at.localeCompare(b.display_at) || a.position - b.position
    : a.position - b.position || a.display_at.localeCompare(b.display_at));
}

export function MessageList({ channel, identities, activeIdentityId, onIdentityChange, onManageIdentities }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [atts, setAtts] = useState<Map<string, Attachment[]>>(new Map());
  const [replies, setReplies] = useState<Map<string, ReplyPreview>>(new Map());
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string; saving: boolean } | null>(null);
  const [authorFor, setAuthorFor] = useState<Message | null>(null);
  const [dateFor, setDateFor] = useState<Message | null>(null);
  const [tapped, setTapped] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const stick = useRef(true);
  const ctx = useContextMenu();
  const confirm = useConfirm();
  const toast = useToast();
  const idList = useMemo(() => [...identities.values()], [identities]);

  const merge = useCallback((page: MessagePage, older: boolean) => {
    setMessages((m) => sortMessages(older ? [...page.messages, ...m] : page.messages, channel.sort_mode));
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
  }, [channel.sort_mode]);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError(null);
    try {
      if (offset && scroller.current) anchor.current = { height: scroller.current.scrollHeight, top: scroller.current.scrollTop };
      else stick.current = true;
      merge(await api<MessagePage>(`/api/channels/${channel.id}/messages?offset=${offset}&limit=100`), offset > 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [channel.id, merge]);

  useEffect(() => { void load(0); }, [load]);

  // Sincronização simples entre dispositivos: recarrega ao voltar para a aba
  useEffect(() => {
    const vis = () => {
      if (document.visibilityState === 'visible' && !editing && messages.length <= 100 && navigator.onLine) {
        api<MessagePage>(`/api/channels/${channel.id}/messages?offset=0&limit=100`).then((p) => merge(p, false)).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [channel.id, editing, messages.length, merge]);

  // Rolagem: fica no fim enquanto o usuário estiver no fim; preserva posição ao carregar anteriores
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (anchor.current) {
      el.scrollTop = el.scrollHeight - anchor.current.height + anchor.current.top;
      anchor.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending]);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const replace = (m: Message) => setMessages((list) => sortMessages(list.map((x) => (x.id === m.id ? m : x)), channel.sort_mode));

  // ── Envio ────────────────────────────────────────────
  async function deliver(p: Pending) {
    setPending((list) => list.map((x) => (x.tmp === p.tmp ? { ...x, status: 'sending', error: undefined } : x)));
    try {
      const m = await api<Message>(`/api/channels/${channel.id}/messages`, { method: 'POST', body: { content: p.content, identity_id: p.identity_id } });
      setPending((list) => list.filter((x) => x.tmp !== p.tmp));
      setMessages((list) => sortMessages([...list, m], channel.sort_mode));
    } catch (e) {
      setPending((list) => list.map((x) => (x.tmp === p.tmp ? { ...x, status: 'failed', error: (e as Error).message } : x)));
    }
  }

  function send(content: string) {
    const identity_id = activeIdentityId ?? idList.find((i) => i.is_owner)?.id ?? null;
    const p: Pending = { tmp: `tmp-${Date.now()}-${Math.random()}`, content, identity_id, display_at: new Date().toISOString(), status: 'sending' };
    stick.current = true;
    setPending((list) => [...list, p]);
    void deliver(p);
  }

  // ── Ações ────────────────────────────────────────────
  async function patch(m: Message, body: Record<string, unknown>, ok?: string) {
    try {
      replace(await api<Message>(`/api/messages/${m.id}`, { method: 'PATCH', body }));
      if (ok) toast.success(ok);
      return true;
    } catch (e) { toast.error((e as Error).message); return false; }
  }

  async function saveEdit() {
    if (!editing) return;
    const m = byId.get(editing.id);
    if (!m) { setEditing(null); return; }
    if (!editing.text.trim()) { toast.error('A mensagem não pode ficar vazia. Use “Excluir” para removê-la.'); return; }
    if (editing.text === m.content) { setEditing(null); return; }
    setEditing({ ...editing, saving: true });
    if (await patch(m, { content: editing.text })) setEditing(null);
    else setEditing((e) => (e ? { ...e, saving: false } : e));
  }

  async function remove(m: Message) {
    const ok = await confirm({
      title: 'Excluir mensagem?', danger: true, confirmLabel: 'Excluir',
      message: <>
        <div className="confirm-quote md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content.slice(0, 600) || '*[apenas anexos]*') }} />
        {(atts.get(m.id)?.length ?? 0) > 0 && <p>Os {atts.get(m.id)!.length} anexo(s) também serão apagados.</p>}
        <p className="muted">Esta ação não pode ser desfeita.</p>
      </>,
    });
    if (!ok) return;
    try {
      await api(`/api/messages/${m.id}`, { method: 'DELETE' });
      setMessages((list) => list.filter((x) => x.id !== m.id));
      toast.success('Mensagem excluída.');
    } catch (e) { toast.error((e as Error).message); }
  }

  async function duplicate(m: Message) {
    try {
      const r = await api<{ message: Message; attachments_skipped: boolean }>(`/api/messages/${m.id}/duplicate`, { method: 'POST' });
      setMessages((list) => sortMessages([...list, r.message], channel.sort_mode));
      toast.success(r.attachments_skipped ? 'Mensagem duplicada (os anexos não foram copiados).' : 'Mensagem duplicada.');
    } catch (e) { toast.error((e as Error).message); }
  }

  async function copy(m: Message) {
    try { await navigator.clipboard.writeText(m.content); toast.success('Texto copiado.'); }
    catch { toast.error('Não foi possível copiar.'); }
  }

  const menuFor = (m: Message): MenuEntry[] => [
    { label: 'Editar texto', icon: <IconEdit size={16} />, onSelect: () => setEditing({ id: m.id, text: m.content, saving: false }) },
    { label: 'Alterar autor', icon: <span className="ctx-glyph">@</span>, onSelect: () => setAuthorFor(m) },
    { label: 'Alterar data e hora', icon: <span className="ctx-glyph">◷</span>, onSelect: () => setDateFor(m) },
    'separator',
    { label: 'Duplicar', icon: <span className="ctx-glyph">⧉</span>, onSelect: () => duplicate(m) },
    { label: 'Copiar texto', icon: <span className="ctx-glyph">❐</span>, onSelect: () => copy(m), disabled: !m.content },
    'separator',
    { label: 'Excluir mensagem', icon: <IconTrash size={16} />, danger: true, onSelect: () => remove(m) },
  ];

  function jumpTo(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) { toast.info('A mensagem original está mais acima — carregue as mensagens anteriores.'); return; }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
  }

  const composer = (
    <Composer
      key={channel.id}
      channel={channel}
      identities={idList}
      activeIdentityId={activeIdentityId}
      onIdentityChange={onIdentityChange}
      onManageIdentities={onManageIdentities}
      onSend={send}
    />
  );

  const dialogs = (
    <>
      {authorFor && (
        <Modal title="Alterar autor" onClose={() => setAuthorFor(null)} width={380}>
          <IdentityPicker inline identities={idList} value={authorFor.identity_id}
            onPick={async (id) => { const m = authorFor; setAuthorFor(null); await patch(m, { identity_id: id }, 'Autor alterado.'); }}
            onManage={() => { setAuthorFor(null); onManageIdentities(); }}
            onClose={() => setAuthorFor(null)} />
        </Modal>
      )}
      {dateFor && <DateDialog message={dateFor} onClose={() => setDateFor(null)} onSave={(iso) => patch(dateFor, { display_at: iso }, 'Data alterada.')} />}
    </>
  );

  if (error && !messages.length) {
    return (
      <>
        <div className="main__body"><div className="empty">
          <IconAlert size={28} />
          <h3>Não foi possível carregar</h3>
          <p>{error}</p>
          <button className="btn" onClick={() => load(0)}><IconRefresh size={15} /> Tentar novamente</button>
        </div></div>
        {composer}
      </>
    );
  }

  let prev: { identity_id: string | null; display_at: string } | null = null;
  const empty = !loading && !messages.length && !pending.length;

  return (
    <>
      <div className="main__body" ref={scroller}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {empty ? (
          <div className="empty">
            <div className="empty__chan" style={{ color: channel.color ?? undefined }}>{channel.icon ?? <IconHash size={30} />}</div>
            <h3>#{channel.name}</h3>
            <p>{channel.topic ?? 'Este é o começo do canal. Escreva a primeira mensagem abaixo.'}</p>
          </div>
        ) : (
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
              const newDay = !prev || localDay(prev.display_at) !== localDay(m.display_at);
              const cont = !!prev && !newDay && !m.reply_to_id && prev.identity_id === m.identity_id
                && Math.abs(new Date(m.display_at).getTime() - new Date(prev.display_at).getTime()) < GROUP_MS;
              prev = m;
              const reply = m.reply_to_id ? byId.get(m.reply_to_id) ?? replies.get(m.reply_to_id) : undefined;
              const replyIdn = reply?.identity_id ? identities.get(reply.identity_id) : undefined;
              const d = new Date(m.display_at);
              const isEditing = editing?.id === m.id;
              return (
                <div key={m.id}>
                  {newDay && <div className="day-sep">{fmtDay.format(d)}</div>}
                  <article id={`msg-${m.id}`}
                    className={`msg ${cont ? 'msg--cont' : ''} ${m.reply_to_id ? 'msg--reply' : ''} ${isEditing ? 'is-editing' : ''} ${tapped === m.id ? 'is-tapped' : ''}`}
                    style={{ '--idc': idn?.color ?? 'var(--text)' } as React.CSSProperties}
                    onContextMenu={isEditing ? undefined : ctx.onContextMenu(menuFor(m))}
                    onClick={(e) => { if (window.matchMedia('(hover: none)').matches && !(e.target as HTMLElement).closest('a,button,textarea')) setTapped((t) => (t === m.id ? null : m.id)); }}>
                    {m.reply_to_id && (
                      <button className="msg__reply" onClick={() => jumpTo(m.reply_to_id!)} title="Ir para a mensagem original">
                        {reply ? <><b>{replyIdn?.name ?? 'Desconhecido'}</b><span>{plainText(reply.content) || 'anexo'}</span></> : <span>Mensagem original indisponível</span>}
                      </button>
                    )}
                    {cont
                      ? <div className="msg__gutter" title={fmtLong.format(d)}>{fmtTime.format(d)}</div>
                      : <Avatar identity={idn} />}
                    <div className="msg__body">
                      {!cont && (
                        <div className="msg__head">
                          <span className="msg__author">{idn?.name ?? 'Sem autor'}</span>
                          <time className="msg__time" dateTime={m.display_at} title={fmtLong.format(d)}>{fmtFull.format(d)}</time>
                          {m.pinned_at && <span className="msg__pin" title="Fixada">● fixada</span>}
                        </div>
                      )}
                      {isEditing ? (
                        <div className="msg__edit">
                          <MarkdownEditor compact autoFocus value={editing.text}
                            onChange={(text) => setEditing((e) => (e ? { ...e, text } : e))}
                            onSubmit={saveEdit} onCancel={() => setEditing(null)} />
                          <div className="msg__edit-hint">
                            Esc <button className="link-btn" onClick={() => setEditing(null)}>cancelar</button> · Enter <button className="link-btn" onClick={saveEdit} disabled={editing.saving}>{editing.saving ? 'salvando…' : 'salvar'}</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {m.content && <div className="md" dangerouslySetInnerHTML={{ __html: withEdited(renderMarkdown(m.content), m.edited_at) }} />}
                          {m.extra?.embeds?.map((e, i) => (
                            <div key={i} className="embed" style={{ '--ec': e.color ? `#${e.color.toString(16).padStart(6, '0')}` : undefined } as React.CSSProperties}>
                              {e.author && <small className="muted">{e.author}</small>}
                              {e.title && (e.url ? <a href={e.url} target="_blank" rel="noreferrer nofollow"><b>{e.title}</b></a> : <b>{e.title}</b>)}
                              {e.description && <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(e.description) }} />}
                              {e.footer && <small className="muted">{e.footer}</small>}
                            </div>
                          ))}
                          {atts.get(m.id) && <div className="atts">{atts.get(m.id)!.map((a) => <AttachmentView key={a.id} a={a} />)}</div>}
                        </>
                      )}
                    </div>
                    {!isEditing && (
                      <div className="msg__actions" role="toolbar" aria-label="Ações da mensagem">
                        <button className="icon-btn icon-btn--sm" title="Editar" aria-label="Editar mensagem" onClick={() => setEditing({ id: m.id, text: m.content, saving: false })}><IconEdit size={15} /></button>
                        <button className="icon-btn icon-btn--sm" title="Mais ações" aria-label="Mais ações" onClick={ctx.fromButton(menuFor(m))}><IconMore size={15} /></button>
                      </div>
                    )}
                  </article>
                </div>
              );
            })}
            {pending.map((p) => {
              const idn = p.identity_id ? identities.get(p.identity_id) : undefined;
              return (
                <article key={p.tmp} className={`msg msg--pending ${p.status === 'failed' ? 'is-failed' : ''}`} style={{ '--idc': idn?.color ?? 'var(--text)' } as React.CSSProperties}>
                  <Avatar identity={idn} />
                  <div className="msg__body">
                    <div className="msg__head">
                      <span className="msg__author">{idn?.name ?? 'Sem autor'}</span>
                      <span className="msg__time">{p.status === 'sending' ? 'enviando…' : 'não enviada'}</span>
                    </div>
                    <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(p.content) }} />
                    {p.status === 'failed' && (
                      <div className="msg__fail">
                        <IconAlert size={14} /> {p.error}
                        <button className="link-btn" onClick={() => deliver(p)}>Tentar de novo</button>
                        <button className="link-btn" onClick={() => setPending((l) => l.filter((x) => x.tmp !== p.tmp))}>Descartar</button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
      {composer}
      {dialogs}
    </>
  );
}

/** Altera a data/hora EXIBIDA. Os registros técnicos são apenas mostrados. */
function DateDialog({ message, onClose, onSave }: { message: Message; onClose: () => void; onSave: (iso: string) => Promise<boolean> }) {
  const toLocal = (iso: string) => {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
  };
  const init = toLocal(message.display_at);
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [busy, setBusy] = useState(false);
  const candidate = new Date(`${date}T${time || '00:00'}`);
  const valid = !!date && !Number.isNaN(candidate.getTime());

  async function save() {
    if (!valid) return;
    setBusy(true);
    if (await onSave(candidate.toISOString())) onClose();
    else setBusy(false);
  }

  return (
    <Modal title="Data e hora da mensagem" onClose={onClose} width={420}
      footer={<>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn--primary" onClick={save} disabled={!valid || busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </>}>
      <div className="form">
        <p className="muted small" style={{ marginTop: -4 }}>Altera apenas a data <strong>exibida</strong>. A ordem manual da mensagem e os registros técnicos não mudam.</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <label className="field field--grow"><span>Data</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field" style={{ width: 130 }}><span>Hora</span><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        </div>
        <button type="button" className="btn btn--sm btn--ghost" style={{ alignSelf: 'flex-start' }}
          onClick={() => { const n = toLocal(new Date().toISOString()); setDate(n.date); setTime(n.time); }}>Usar data e hora atuais</button>
        <dl className="meta">
          <dt>Exibida como</dt><dd>{valid ? fmtLong.format(candidate) : '—'}</dd>
          <dt>Criada no ORBE</dt><dd>{fmtLong.format(new Date(message.created_at))}</dd>
          <dt>Última edição do texto</dt><dd>{message.edited_at ? fmtLong.format(new Date(message.edited_at)) : 'nunca editada'}</dd>
        </dl>
      </div>
    </Modal>
  );
}
