'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '@/lib/client/api';
import { plainText, renderMarkdown } from '@/lib/markdown';
import type { Attachment, Channel, Identity, Message, MessagePage, ReplyPreview, SortMode } from '@/lib/types';
import { IconAlert, IconCheckSquare, IconClock, IconDownload, IconEdit, IconExternal, IconGrip, IconHash, IconLink, IconMore, IconMove, IconPaperclip, IconPin, IconRefresh, IconReply, IconSort, IconTrash } from './ui/Icons';
import { Lightbox } from './Lightbox';
import { FileViewer, viewKind } from './FileViewer';
import { humanSize, uploadAttachment } from '@/lib/client/upload';
import { downloadBlob, makeZip, uniqueName } from '@/lib/client/zip';
import type { ExportRequest } from './ExportDialog';
import { useContextMenu, type MenuEntry } from './ui/ContextMenu';
import { useConfirm } from './ui/ConfirmDialog';
import { useToast } from './ui/Toasts';
import { Modal } from './ui/Modal';
import { MarkdownEditor } from './MarkdownEditor';
import { Composer } from './Composer';
import { IdentityPicker } from './IdentityPicker';

export interface ChannelOption { id: string; name: string; path: string }

interface Props {
  channel: Channel;
  identities: Map<string, Identity>;
  channels: ChannelOption[];
  activeIdentityId: string | null;
  jumpTo: string | null;
  onJumped: () => void;
  onIdentityChange: (id: string) => void;
  onManageIdentities: () => void;
  onSortModeChange: (mode: SortMode) => Promise<void>;
  onOpenChannel: (channelId: string, messageId?: string) => void;
  onExport: (req: ExportRequest) => void;
  /** Cria um canal-página a partir de um anexo HTML */
  onMakePage: (a: Attachment) => void;
}

/** Mensagem local ainda não confirmada pelo servidor */
interface Pending {
  tmp: string; content: string; identity_id: string | null; reply_to_id: string | null; display_at: string;
  status: 'sending' | 'failed'; error?: string;
  files: File[]; done: number; current?: string; progress?: number;
  messageId?: string; created?: Message;
}

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

export const isImage = (a: Attachment) => a.mime_type.startsWith('image/') && !a.mime_type.includes('svg');

function AttachmentView({ a, onOpen, onRemove, onView }: { a: Attachment; onOpen?: () => void; onRemove?: () => void; onView?: () => void }) {
  const url = fileUrl(a.storage_path);
  const dl = `${url}?download=${encodeURIComponent(a.file_name)}`;
  const remove = onRemove && (
    <button type="button" className="att-x" onClick={onRemove} aria-label={`Remover ${a.file_name}`} title="Remover anexo">×</button>
  );
  if (isImage(a)) {
    // Reserva o espaço pela proporção real (evita a tela "pular" ao carregar)
    const ratio = a.width && a.height ? `${a.width} / ${a.height}` : undefined;
    return (
      <div className="att-wrap">
        <button type="button" className="att-imgbtn" onClick={onOpen} title={`${a.file_name} — clique para ampliar`}>
          <img className="att-img" src={url} alt={a.file_name} loading="lazy" style={{ aspectRatio: ratio }} width={a.width ?? undefined} height={a.height ?? undefined} />
        </button>
        <a className="att-dl" href={dl} title="Baixar imagem" aria-label={`Baixar ${a.file_name}`} onClick={(e) => e.stopPropagation()}><IconDownload size={15} /></a>
        {remove}
      </div>
    );
  }
  if (a.mime_type.startsWith('video/')) return <div className="att-wrap"><video className="att-img" src={url} controls preload="metadata" />{remove}</div>;
  if (a.mime_type.startsWith('audio/')) return <div className="att-wrap att-wrap--audio"><audio src={url} controls preload="none" />{remove}</div>;
  const ext = a.file_name.includes('.') ? a.file_name.split('.').pop()!.slice(0, 4) : 'arq';
  const kind = viewKind(a);
  const isPage = kind === 'html';
  return (
    <div className="att-wrap">
      <div className={`att-file ${isPage ? 'att-file--page' : ''}`}>
        <button type="button" className="att-file__open" onClick={onView} disabled={!onView || !kind}
          title={kind ? (isPage ? 'Abrir página dentro do ORBE' : 'Abrir dentro do ORBE') : 'Sem pré-visualização — use o download'}>
          <span className="att-file__ext">{isPage ? 'html' : ext}</span>
          <span className="att-file__info">{a.file_name}<small>{humanSize(a.size_bytes)}{kind ? ` · ${isPage ? 'abrir página' : 'abrir'}` : ''}</small></span>
        </button>
        <a className="icon-btn icon-btn--sm" href={dl} title="Baixar" aria-label={`Baixar ${a.file_name}`}><IconDownload size={15} /></a>
      </div>
      {remove}
    </div>
  );
}

/** Coloca o marcador "(editada)" no fim do último parágrafo, quando houver. */
function withEdited(html: string, editedAt: string | null) {
  if (!editedAt) return html;
  const tag = `<span class="edited" title="Editada em ${fmtLong.format(new Date(editedAt))}">(editada)</span>`;
  return html.endsWith('</p>') ? `${html.slice(0, -4)}${tag}</p>` : html + tag;
}

function sortMessages(list: Message[], mode: SortMode) {
  return [...list].sort((a, b) => mode === 'chronological'
    ? a.display_at.localeCompare(b.display_at) || a.position - b.position
    : a.position - b.position || a.display_at.localeCompare(b.display_at));
}

// ─────────────────────────────────────────────────────────────
// Uma mensagem (arrastável no modo manual)
// ─────────────────────────────────────────────────────────────
interface RowProps {
  m: Message;
  identities: Map<string, Identity>;
  newDay: boolean;
  cont: boolean;
  reply: ReplyPreview | undefined;
  atts: Attachment[] | undefined;
  editing: { text: string; saving: boolean } | null;
  tapped: boolean;
  draggable: boolean;
  menu: MenuEntry[];
  onTap: () => void;
  onEditStart: () => void;
  onEditChange: (t: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onReply: () => void;
  onJump: (id: string) => void;
  onDateEdit: () => void;
  onOpenImage: (a: Attachment) => void;
  onViewFile: (a: Attachment) => void;
  onRemoveAttachment: (a: Attachment) => void;
  onAddFiles: (files: File[]) => void;
  uploading: string | null;
  selecting: boolean;
  selected: boolean;
  onSelectClick: (shift: boolean) => void;
}

const MessageRow = memo(function MessageRow(p: RowProps) {
  const { m } = p;
  const ctx = useContextMenu();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: m.id, disabled: !p.draggable });
  const idn = m.identity_id ? p.identities.get(m.identity_id) : undefined;
  const system = !!m.extra?.system;
  const replyIdn = p.reply?.identity_id ? p.identities.get(p.reply.identity_id) : undefined;
  const d = new Date(m.display_at);
  const style = { transform: CSS.Translate.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'is-dragging' : undefined}>
      {p.newDay && <div className="day-sep">{fmtDay.format(d)}</div>}
      <article id={`msg-${m.id}`}
        className={`msg ${p.cont || system ? 'msg--cont' : ''} ${system ? 'msg--log' : ''} ${m.reply_to_id ? 'msg--reply' : ''} ${p.editing ? 'is-editing' : ''} ${p.tapped ? 'is-tapped' : ''} ${m.pinned_at ? 'is-pinned' : ''} ${p.selecting ? 'is-selecting' : ''} ${p.selected ? 'is-selected' : ''}`}
        style={{ '--idc': idn?.color ?? 'var(--text)' } as React.CSSProperties}
        aria-selected={p.selecting ? p.selected : undefined}
        onContextMenu={p.editing || p.selecting ? undefined : ctx.onContextMenu(p.menu)}
        onMouseDown={(e) => { if (p.selecting && e.shiftKey) e.preventDefault(); /* evita selecionar texto no Shift+clique */ }}
        onClick={(e) => {
          if (p.selecting) {
            if (!(e.target as HTMLElement).closest('a')) { e.preventDefault(); p.onSelectClick(e.shiftKey); }
            return;
          }
          if (window.matchMedia('(hover: none)').matches && !(e.target as HTMLElement).closest('a,button,textarea')) p.onTap();
        }}>
        {p.selecting && <span className="msg__check" aria-hidden="true">{p.selected ? '✓' : ''}</span>}
        {m.reply_to_id && (
          <button className="msg__reply" onClick={() => p.onJump(m.reply_to_id!)} title="Ir para a mensagem original">
            {p.reply ? <><b>{replyIdn?.name ?? 'Sem autor'}</b><span>{plainText(p.reply.content) || 'anexo'}</span></> : <span>Mensagem original indisponível</span>}
          </button>
        )}
        {p.draggable && !p.editing && (
          <button ref={setActivatorNodeRef} className="msg__grip" aria-label="Arrastar para reordenar" title="Arrastar para reordenar" {...attributes} {...listeners}>
            <IconGrip size={14} />
          </button>
        )}
        {system
          // Registro solto (LOG): sem avatar nem nome — só o horário ao lado do cartão
          ? <div className="msg__gutter msg__gutter--log" title={fmtLong.format(d)}>{fmtTime.format(d)}</div>
          : p.cont
            ? <div className="msg__gutter" title={fmtLong.format(d)}>{fmtTime.format(d)}</div>
            : <Avatar identity={idn} />}
        <div className="msg__body">
          {!p.cont && !system && (
            <div className="msg__head">
              <span className="msg__author">{idn?.name ?? 'Sem autor'}</span>
              <button type="button" className="msg__time msg__time--btn" onClick={p.onDateEdit} title={`${fmtLong.format(d)} — clique para alterar a data e hora`}>
                <time dateTime={m.display_at}>{fmtFull.format(d)}</time>
              </button>
              {m.pinned_at && <span className="msg__pin" title="Fixada"><IconPin size={11} /> fixada</span>}
            </div>
          )}
          {p.editing ? (
            <div className="msg__edit">
              <MarkdownEditor compact autoFocus value={p.editing.text} onChange={p.onEditChange} onSubmit={p.onEditSave} onCancel={p.onEditCancel}
                onPasteFiles={p.onAddFiles} />
              <div className="msg__edit-hint">
                Esc <button className="link-btn" onClick={p.onEditCancel}>cancelar</button> · Enter <button className="link-btn" onClick={p.onEditSave} disabled={p.editing.saving}>{p.editing.saving ? 'salvando…' : 'salvar'}</button>
                {' · '}
                <label className="link-btn" style={{ cursor: 'pointer' }}>
                  <input type="file" multiple hidden onChange={(e) => { p.onAddFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
                  anexar arquivo
                </label>
                {p.uploading && <span className="muted"> · enviando {p.uploading}…</span>}
              </div>
              {p.atts && p.atts.length > 0 && (
                <div className="atts atts--edit">{p.atts.map((a) => <AttachmentView key={a.id} a={a} onRemove={() => p.onRemoveAttachment(a)} />)}</div>
              )}
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
              {p.atts && <div className="atts">{p.atts.map((a) => <AttachmentView key={a.id} a={a} onOpen={p.selecting ? undefined : () => p.onOpenImage(a)} onView={p.selecting ? undefined : () => p.onViewFile(a)} />)}</div>}
            </>
          )}
        </div>
        {!p.editing && !p.selecting && (
          <div className="msg__actions" role="toolbar" aria-label="Ações da mensagem">
            <button className="icon-btn icon-btn--sm" title="Responder" aria-label="Responder" onClick={p.onReply}><IconReply size={15} /></button>
            <button className="icon-btn icon-btn--sm" title="Editar texto" aria-label="Editar mensagem" onClick={p.onEditStart}><IconEdit size={15} /></button>
            <button className="icon-btn icon-btn--sm" title="Alterar data e hora" aria-label="Alterar data e hora" onClick={p.onDateEdit}><IconClock size={15} /></button>
            <button className="icon-btn icon-btn--sm" title="Mais ações" aria-label="Mais ações" onClick={ctx.fromButton(p.menu)}><IconMore size={15} /></button>
          </div>
        )}
      </article>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────
export function MessageList(props: Props) {
  const { channel, identities, activeIdentityId } = props;
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [atts, setAtts] = useState<Map<string, Attachment[]>>(new Map());
  const [replies, setReplies] = useState<Map<string, ReplyPreview>>(new Map());
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string; saving: boolean } | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [authorFor, setAuthorFor] = useState<Message | null>(null);
  const [dateFor, setDateFor] = useState<Message | null>(null);
  const [moveFor, setMoveFor] = useState<Message | null>(null);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [viewer, setViewer] = useState<{ images: Attachment[]; start: number } | null>(null);
  const [viewFile, setViewFile] = useState<Attachment | null>(null);
  const [zipping, setZipping] = useState<string | null>(null);
  const [uploadingTo, setUploadingTo] = useState<{ id: string; name: string } | null>(null);
  // Seleção para exportar
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchorSel = useRef<string | null>(null);
  const [tapped, setTapped] = useState<string | null>(null);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const stick = useRef(true);
  const pendingJump = useRef<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const idList = useMemo(() => [...identities.values()], [identities]);
  const manual = channel.sort_mode === 'manual';

  useEffect(() => { setHeaderSlot(document.getElementById('chan-actions')); }, []);

  const modeRef = useRef(channel.sort_mode);
  modeRef.current = channel.sort_mode;

  const merge = useCallback((page: MessagePage, older: boolean) => {
    setMessages((m) => {
      const map = new Map((older ? [...page.messages, ...m] : page.messages).map((x) => [x.id, x]));
      return sortMessages([...map.values()], modeRef.current);
    });
    setAtts((prev) => {
      const next = new Map(older ? prev : []);
      for (const a of page.attachments) {
        const list = next.get(a.message_id) ?? [];
        if (!list.some((x) => x.id === a.id)) next.set(a.message_id, [...list, a]);
      }
      return next;
    });
    setReplies((prev) => {
      const next = new Map(older ? prev : []);
      for (const r of page.replies) next.set(r.id, r);
      return next;
    });
    setHasMore(page.has_more);
  }, []);

  const load = useCallback(async (offset: number, around?: string) => {
    setLoading(true);
    setError(null);
    try {
      if (offset && scroller.current) anchor.current = { height: scroller.current.scrollHeight, top: scroller.current.scrollTop };
      else if (!around) stick.current = true;
      const q = around ? `around=${around}` : `offset=${offset}&limit=100`;
      merge(await api<MessagePage>(`/api/channels/${channel.id}/messages?${q}`), offset > 0);
    } catch (e) {
      setError((e as Error).message);
      if (around) toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [channel.id, merge, toast]);

  // Carrega uma vez por canal (a troca de modo de ordenação apenas reordena o que já está na tela)
  useEffect(() => {
    if (props.jumpTo) { pendingJump.current = props.jumpTo; stick.current = false; void load(0, props.jumpTo); props.onJumped(); }
    else void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  // Link interno aberto com o canal já carregado (o primeiro carregamento já trata o salto)
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    if (!props.jumpTo) return;
    const id = props.jumpTo;
    props.onJumped();
    void jumpTo(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.jumpTo]);

  // Trocar o modo de ordenação reordena o que já está carregado
  useEffect(() => { setMessages((m) => sortMessages(m, channel.sort_mode)); }, [channel.sort_mode]);

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

  // Rolagem: fim do canal, posição preservada ao carregar anteriores, ou salto para uma mensagem
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (pendingJump.current) {
      const target = document.getElementById(`msg-${pendingJump.current}`);
      if (target) { flash(target); pendingJump.current = null; return; }
    }
    if (anchor.current) {
      el.scrollTop = el.scrollHeight - anchor.current.height + anchor.current.top;
      anchor.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending]);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const replace = (m: Message) => setMessages((list) => sortMessages(list.map((x) => (x.id === m.id ? m : x)), channel.sort_mode));

  function flash(el: HTMLElement) {
    el.scrollIntoView({ block: 'center' });
    const art = el.matches('.msg') ? el : el.querySelector('.msg') ?? el;
    art.classList.remove('is-flash');
    void (art as HTMLElement).offsetWidth;
    art.classList.add('is-flash');
  }

  async function jumpTo(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (el) { stick.current = false; flash(el); return; }
    // Fora do que está carregado: busca no servidor (pode estar em outro canal)
    try {
      const [m] = await api<Message[]>(`/api/messages/${id}/locate`);
      if (m && m.channel_id !== channel.id) { props.onOpenChannel(m.channel_id, id); return; }
    } catch { /* segue tentando neste canal */ }
    pendingJump.current = id;
    stick.current = false;
    await load(0, id);
  }

  // ── Envio ────────────────────────────────────────────
  const updPending = (tmp: string, patch: Partial<Pending>) =>
    setPending((list) => list.map((x) => (x.tmp === tmp ? { ...x, ...patch } : x)));

  /**
   * Envia a mensagem e depois cada anexo, em ordem. Se algo falhar, o item fica na tela
   * com "Tentar de novo", que continua de onde parou (sem recriar a mensagem nem reenviar
   * arquivos que já chegaram).
   */
  async function deliver(p: Pending) {
    updPending(p.tmp, { status: 'sending', error: undefined });
    let messageId = p.messageId;
    let created: Message | null = null;
    try {
      if (!messageId) {
        created = await api<Message>(`/api/channels/${channel.id}/messages`, {
          method: 'POST',
          body: { content: p.content, identity_id: p.identity_id, reply_to_id: p.reply_to_id, with_attachments: p.files.length > 0 },
        });
        messageId = created.id;
        p.messageId = messageId;
        p.created = created;
        updPending(p.tmp, { messageId, created });
      }
      for (let i = p.done; i < p.files.length; i++) {
        const f = p.files[i];
        updPending(p.tmp, { current: f.name, progress: 0 });
        const a = await uploadAttachment(messageId, f, (prog) => updPending(p.tmp, { progress: prog }));
        setAtts((prev) => new Map(prev).set(a.message_id, [...(prev.get(a.message_id) ?? []), a]));
        p.done = i + 1;
        updPending(p.tmp, { done: i + 1 });
      }
      const m = p.created ?? created;
      setPending((list) => list.filter((x) => x.tmp !== p.tmp));
      if (m) setMessages((list) => sortMessages([...list.filter((x) => x.id !== m.id), m], channel.sort_mode));
      if (p.reply_to_id && !replies.has(p.reply_to_id)) {
        const src = byId.get(p.reply_to_id);
        if (src) setReplies((r) => new Map(r).set(src.id, { id: src.id, identity_id: src.identity_id, content: src.content.slice(0, 200) }));
      }
    } catch (e) {
      updPending(p.tmp, { status: 'failed', error: (e as Error).message });
    }
  }

  /** Desiste dos anexos que faltam, mantendo a mensagem já criada. */
  function keepWithoutRest(p: Pending) {
    setPending((list) => list.filter((x) => x.tmp !== p.tmp));
    if (p.created) setMessages((list) => sortMessages([...list.filter((x) => x.id !== p.created!.id), p.created!], channel.sort_mode));
  }

  function send(content: string, files: File[] = []) {
    const identity_id = activeIdentityId ?? idList.find((i) => i.is_owner)?.id ?? null;
    const p: Pending = { tmp: `tmp-${Date.now()}-${Math.random()}`, content, identity_id, reply_to_id: replyTo?.id ?? null, display_at: new Date().toISOString(), status: 'sending', files, done: 0 };
    stick.current = true;
    setReplyTo(null);
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
    if (!editing.text.trim() && !(atts.get(m.id)?.length)) { toast.error('A mensagem não pode ficar vazia. Use “Excluir” para removê-la.'); return; }
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
        <p className="muted">Uma cópia{(atts.get(m.id)?.length ?? 0) > 0 ? ` (com ${atts.get(m.id)!.length} anexo(s))` : ''} fica em <b>LOG › #log</b> para recuperação.</p>
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
      const r = await api<{ message: Message; attachments: Attachment[]; attachments_skipped: boolean }>(`/api/messages/${m.id}/duplicate`, { method: 'POST' });
      if (r.attachments?.length) setAtts((prev) => new Map(prev).set(r.message.id, r.attachments));
      setMessages((list) => sortMessages([...list, r.message], channel.sort_mode));
      toast.success(r.attachments_skipped ? 'Mensagem duplicada, mas alguns anexos não puderam ser copiados.' : 'Mensagem duplicada.');
    } catch (e) { toast.error((e as Error).message); }
  }

  // ── Anexos em mensagens existentes ───────────────────
  async function removeAttachment(a: Attachment) {
    const ok = await confirm({
      title: 'Remover anexo?', danger: true, confirmLabel: 'Remover',
      message: <><p>“{a.file_name}” ({humanSize(a.size_bytes)}) sai desta mensagem.</p><p className="muted">O arquivo fica guardado em <b>LOG › #log</b> para recuperação.</p></>,
    });
    if (!ok) return;
    try {
      await api(`/api/attachments/${a.id}`, { method: 'DELETE' });
      setAtts((prev) => new Map(prev).set(a.message_id, (prev.get(a.message_id) ?? []).filter((x) => x.id !== a.id)));
      toast.success('Anexo removido.');
    } catch (e) { toast.error((e as Error).message); }
  }

  async function addFilesTo(messageId: string, files: File[]) {
    for (const f of files) {
      setUploadingTo({ id: messageId, name: f.name });
      try {
        const a = await uploadAttachment(messageId, f);
        setAtts((prev) => new Map(prev).set(messageId, [...(prev.get(messageId) ?? []), a]));
      } catch (e) {
        toast.error((e as Error).message);
        break;
      }
    }
    setUploadingTo(null);
  }

  // ── Visualizador ─────────────────────────────────────
  const images = useMemo(() => messages.flatMap((m) => (atts.get(m.id) ?? []).filter(isImage)), [messages, atts]);
  function openImage(a: Attachment) {
    const i = images.findIndex((x) => x.id === a.id);
    setViewer({ images, start: Math.max(0, i) });
  }

  // ── Baixar todos os anexos do canal (.zip gerado no navegador) ──
  async function downloadAll() {
    if (zipping) return;
    try {
      const list = await api<(Attachment & { display_at: string })[]>(`/api/channels/${channel.id}/attachments`);
      if (!list.length) { toast.info('Este canal não tem anexos.'); return; }
      const total = list.reduce((n, a) => n + a.size_bytes, 0);
      if (total > 400 * 1024 * 1024) { toast.error('Mais de 400 MB de anexos: grande demais para um único .zip no navegador.'); return; }
      const used = new Set<string>();
      const entries = [];
      let failed = 0;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        setZipping(`${i + 1}/${list.length}`);
        try {
          const res = await fetch(fileUrl(a.storage_path), { credentials: 'same-origin' });
          if (!res.ok) throw new Error();
          entries.push({ name: uniqueName(a.file_name, used), data: new Uint8Array(await res.arrayBuffer()), date: new Date(a.display_at) });
        } catch { failed++; }
      }
      const safe = channel.name.replace(/[\\/:*?"<>|]+/g, '_');
      downloadBlob(makeZip(entries), `${safe} - anexos.zip`);
      toast.success(failed ? `ZIP gerado, mas ${failed} arquivo(s) não puderam ser baixados.` : `${entries.length} anexos baixados em .zip.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setZipping(null);
    }
  }

  async function copy(text: string, ok: string) {
    try { await navigator.clipboard.writeText(text); toast.success(ok); }
    catch { toast.error('Não foi possível copiar.'); }
  }

  async function moveTo(m: Message, target: ChannelOption) {
    try {
      await api(`/api/messages/${m.id}/move`, { method: 'POST', body: { channel_id: target.id } });
      setMessages((list) => list.filter((x) => x.id !== m.id));
      toast.success(`Mensagem movida para #${target.name}.`);
    } catch (e) { toast.error((e as Error).message); }
  }

  const menuFor = (m: Message): MenuEntry[] => [
    { label: 'Responder', icon: <IconReply size={16} />, onSelect: () => setReplyTo(m) },
    { label: 'Editar texto', icon: <IconEdit size={16} />, onSelect: () => setEditing({ id: m.id, text: m.content, saving: false }) },
    { label: m.pinned_at ? 'Desafixar' : 'Fixar mensagem', icon: <IconPin size={16} />, onSelect: () => patch(m, { pinned: !m.pinned_at }, m.pinned_at ? 'Mensagem desafixada.' : 'Mensagem fixada.') },
    'separator',
    { label: 'Alterar autor', icon: <span className="ctx-glyph">@</span>, onSelect: () => setAuthorFor(m) },
    { label: 'Alterar data e hora', icon: <span className="ctx-glyph">◷</span>, onSelect: () => setDateFor(m) },
    { label: 'Mover para outro canal…', icon: <IconMove size={16} />, onSelect: () => setMoveFor(m) },
    'separator',
    { label: 'Duplicar', icon: <span className="ctx-glyph">⧉</span>, onSelect: () => duplicate(m) },
    { label: 'Copiar texto', icon: <span className="ctx-glyph">❐</span>, onSelect: () => copy(m.content, 'Texto copiado.'), disabled: !m.content },
    { label: 'Copiar link da mensagem', icon: <IconLink size={16} />, onSelect: () => copy(`${location.origin}/?c=${channel.id}&m=${m.id}`, 'Link copiado. Abra-o no ORBE para ir direto a esta mensagem.') },
    'separator',
    { label: 'Excluir mensagem', icon: <IconTrash size={16} />, danger: true, onSelect: () => remove(m) },
  ];

  // ── Arrastar e soltar (modo manual) ──────────────────
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd(e: DragEndEvent) {
    const from = messages.findIndex((m) => m.id === e.active.id);
    const to = e.over ? messages.findIndex((m) => m.id === e.over!.id) : -1;
    if (from < 0 || to < 0 || from === to) return;
    const next = [...messages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const after = next[to - 1] ?? null;
    const before = next[to + 1] ?? null;
    // Otimista: posição local entre os vizinhos
    const pos = after && before ? (after.position + before.position) / 2 : after ? after.position + 1 : before ? before.position - 1 : 0;
    const prevList = messages;
    setMessages(next.map((m) => (m.id === moved.id ? { ...m, position: pos } : m)));
    try {
      replace(await api<Message>(`/api/messages/${moved.id}/move`, { method: 'POST', body: { after_id: after?.id ?? null, before_id: before?.id ?? null } }));
    } catch (err) {
      setMessages(prevList);
      toast.error(`Não foi possível mover: ${(err as Error).message}`);
    }
  }

  // ── Barra do canal (no cabeçalho) ────────────────────
  const headerActions = headerSlot && createPortal(
    <>
      <button className={`hbtn ${manual ? '' : 'is-on'}`} title={manual ? 'Ordem manual — clique para ordenar pela data exibida' : 'Ordem cronológica — clique para voltar à ordem manual'}
        onClick={() => props.onSortModeChange(manual ? 'chronological' : 'manual').catch((e) => toast.error((e as Error).message))}>
        <IconSort size={16} /><span>{manual ? 'Manual' : 'Por data'}</span>
      </button>
      <button className={`hbtn ${pinsOpen ? 'is-on' : ''}`} title="Mensagens fixadas" onClick={() => setPinsOpen((o) => !o)}>
        <IconPin size={16} /><span>Fixadas</span>
      </button>
      <button className={`hbtn ${zipping ? 'is-on' : ''}`} title="Baixar todos os anexos deste canal (.zip)" onClick={downloadAll} disabled={!!zipping}>
        {zipping ? <span className="spinner" /> : <IconPaperclip size={16} />}<span>{zipping ? `Baixando ${zipping}` : 'Anexos'}</span>
      </button>
      <button className={`hbtn ${selecting ? 'is-on' : ''}`} title="Selecionar mensagens para exportar" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
        <IconCheckSquare size={16} /><span>{selecting ? 'Selecionando' : 'Selecionar'}</span>
      </button>
    </>,
    headerSlot,
  );

  // ── Seleção ──────────────────────────────────────────
  function toggleSelect(id: string, shift: boolean) {
    const a = anchorSel.current; // lido antes de atualizar a âncora
    setSelected((cur) => {
      const next = new Set(cur);
      if (shift && a && a !== id) {
        // Intervalo: tudo entre a última mensagem clicada e esta
        const i = messages.findIndex((m) => m.id === a);
        const j = messages.findIndex((m) => m.id === id);
        if (i >= 0 && j >= 0) {
          const [lo, hi] = i < j ? [i, j] : [j, i];
          const on = !cur.has(id) || cur.has(a);
          for (let k = lo; k <= hi; k++) { if (on) next.add(messages[k].id); else next.delete(messages[k].id); }
          return next;
        }
      }
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    anchorSel.current = id;
  }
  function stopSelecting() { setSelecting(false); setSelected(new Set()); anchorSel.current = null; }
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.overlay')) stopSelecting(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selecting]);

  const selectionBar = (
    <div className="selbar" role="toolbar" aria-label="Seleção de mensagens">
      <span className="selbar__count"><b>{selected.size}</b> {selected.size === 1 ? 'selecionada' : 'selecionadas'}</span>
      <span className="selbar__hint">Clique para marcar · Shift+clique marca um intervalo</span>
      <button className="btn btn--sm btn--ghost" onClick={() => setSelected(new Set(messages.map((m) => m.id)))}>
        Selecionar todas{hasMore ? ' (carregadas)' : ''}
      </button>
      <button className="btn btn--sm btn--ghost" onClick={() => setSelected(new Set())} disabled={!selected.size}>Limpar</button>
      <button className="btn btn--sm" onClick={stopSelecting}>Cancelar</button>
      <button className="btn btn--sm btn--primary" disabled={!selected.size}
        onClick={() => props.onExport({ kind: 'messages', ids: messages.filter((m) => selected.has(m.id)).map((m) => m.id), title: `#${channel.name}`, from: `#${channel.name}` })}>
        Exportar…
      </button>
      <button className="btn btn--sm" title="Exportar o canal inteiro, incluindo mensagens ainda não carregadas"
        onClick={() => props.onExport({ kind: 'channels', channelIds: [channel.id], title: `#${channel.name}` })}>
        Canal inteiro…
      </button>
    </div>
  );

  const composer = selecting ? selectionBar : (
    <Composer
      key={channel.id}
      channel={channel}
      identities={idList}
      activeIdentityId={activeIdentityId}
      replyTo={replyTo ? { name: (replyTo.identity_id && identities.get(replyTo.identity_id)?.name) || 'Sem autor', text: plainText(replyTo.content) } : null}
      onCancelReply={() => setReplyTo(null)}
      onIdentityChange={props.onIdentityChange}
      onManageIdentities={props.onManageIdentities}
      onSend={send}
    />
  );

  const dialogs = (
    <>
      {authorFor && (
        <Modal title="Alterar autor" onClose={() => setAuthorFor(null)} width={380}>
          <IdentityPicker inline identities={idList} value={authorFor.identity_id}
            onPick={async (id) => { const m = authorFor; setAuthorFor(null); await patch(m, { identity_id: id }, 'Autor alterado.'); }}
            onManage={() => { setAuthorFor(null); props.onManageIdentities(); }}
            onClose={() => setAuthorFor(null)} />
        </Modal>
      )}
      {dateFor && <DateDialog message={dateFor} onClose={() => setDateFor(null)} onSave={(iso) => patch(dateFor, { display_at: iso }, 'Data alterada.')} />}
      {moveFor && (
        <ChannelPickerDialog channels={props.channels.filter((c) => c.id !== channel.id)} onClose={() => setMoveFor(null)}
          onPick={(c) => { const m = moveFor; setMoveFor(null); void moveTo(m, c); }} />
      )}
      {pinsOpen && <PinsPanel channelId={channel.id} identities={identities} onClose={() => setPinsOpen(false)}
        onJump={(id) => { setPinsOpen(false); void jumpTo(id); }} />}
      {viewFile && <FileViewer attachment={viewFile} onClose={() => setViewFile(null)}
        onMakePage={(a) => { setViewFile(null); props.onMakePage(a); }} />}
      {viewer && <Lightbox images={viewer.images} start={viewer.start} onClose={() => setViewer(null)}
        caption={(a) => { const m = byId.get(a.message_id); const idn = m?.identity_id ? identities.get(m.identity_id) : undefined; return m ? `${idn?.name ?? 'Sem autor'}, ${fmtFull.format(new Date(m.display_at))}` : undefined; }} />}
    </>
  );

  if (error && !messages.length) {
    return (
      <>
        {headerActions}
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

  let prev: Message | null = null;
  const empty = !loading && !messages.length && !pending.length;

  return (
    <>
      {headerActions}
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
            <DndContext id="orbe-messages" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={messages.map((m) => m.id)} strategy={verticalListSortingStrategy} disabled={!manual}>
                {messages.map((m) => {
                  const newDay = !prev || localDay(prev.display_at) !== localDay(m.display_at);
                  const cont = !!prev && !newDay && !m.reply_to_id && prev.identity_id === m.identity_id
                    && Math.abs(new Date(m.display_at).getTime() - new Date(prev.display_at).getTime()) < GROUP_MS;
                  prev = m;
                  const isEditing = editing?.id === m.id;
                  return (
                    <MessageRow key={m.id} m={m} identities={identities} newDay={newDay} cont={cont}
                      reply={m.reply_to_id ? byId.get(m.reply_to_id) ?? replies.get(m.reply_to_id) : undefined}
                      atts={atts.get(m.id)} editing={isEditing ? editing : null} tapped={tapped === m.id}
                      draggable={manual && !editing && !selecting} menu={menuFor(m)}
                      selecting={selecting} selected={selected.has(m.id)} onSelectClick={(shift) => toggleSelect(m.id, shift)}
                      onTap={() => setTapped((t) => (t === m.id ? null : m.id))}
                      onEditStart={() => setEditing({ id: m.id, text: m.content, saving: false })}
                      onEditChange={(text) => setEditing((e) => (e ? { ...e, text } : e))}
                      onEditSave={saveEdit} onEditCancel={() => setEditing(null)}
                      onReply={() => setReplyTo(m)} onJump={jumpTo} onDateEdit={() => setDateFor(m)}
                      onOpenImage={openImage} onViewFile={setViewFile} onRemoveAttachment={removeAttachment}
                      onAddFiles={(files) => void addFilesTo(m.id, files)}
                      uploading={uploadingTo?.id === m.id ? uploadingTo.name : null} />
                  );
                })}
              </SortableContext>
            </DndContext>
            {pending.map((p) => {
              const idn = p.identity_id ? identities.get(p.identity_id) : undefined;
              return (
                <article key={p.tmp} className={`msg msg--pending ${p.status === 'failed' ? 'is-failed' : ''}`} style={{ '--idc': idn?.color ?? 'var(--text)' } as React.CSSProperties}>
                  <Avatar identity={idn} />
                  <div className="msg__body">
                    <div className="msg__head">
                      <span className="msg__author">{idn?.name ?? 'Sem autor'}</span>
                      <span className="msg__time">{p.status === 'sending' ? 'enviando…' : p.messageId ? 'anexos pendentes' : 'não enviada'}</span>
                    </div>
                    {p.content && <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(p.content) }} />}
                    {p.files.length > 0 && (
                      <div className="upl">
                        {p.files.map((f, i) => (
                          <div key={i} className={`upl__row ${i < p.done ? 'is-done' : ''}`}>
                            <IconPaperclip size={13} />
                            <span className="upl__name">{f.name}</span>
                            <small>{humanSize(f.size)}</small>
                            {i < p.done ? <span className="upl__ok">✓</span>
                              : p.status === 'sending' && p.current === f.name
                                ? <span className="upl__bar"><span style={{ width: `${Math.round((p.progress ?? 0) * 100)}%` }} /></span>
                                : null}
                          </div>
                        ))}
                      </div>
                    )}
                    {p.status === 'failed' && (
                      <div className="msg__fail">
                        <IconAlert size={14} /> {p.error}
                        <button className="link-btn" onClick={() => deliver(p)}>Tentar de novo</button>
                        {p.messageId
                          ? <button className="link-btn" onClick={() => keepWithoutRest(p)}>Manter sem os anexos restantes</button>
                          : <button className="link-btn" onClick={() => setPending((l) => l.filter((x) => x.tmp !== p.tmp))}>Descartar</button>}
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

// ─────────────────────────────────────────────────────────────
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

/** Escolha de canal de destino (com busca). */
function ChannelPickerDialog({ channels, onPick, onClose }: { channels: ChannelOption[]; onPick: (c: ChannelOption) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? channels.filter((c) => `${c.path} ${c.name}`.toLowerCase().includes(n)) : channels;
  }, [channels, q]);
  return (
    <Modal title="Mover para outro canal" onClose={onClose} width={440}>
      <div className="form" style={{ gap: 10 }}>
        <input className="input" autoFocus placeholder="Buscar canal…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="chpick">
          {list.map((c) => (
            <li key={c.id}><button className="chpick__item" onClick={() => onPick(c)}><IconHash size={14} /><span>{c.name}</span><small>{c.path}</small></button></li>
          ))}
          {!list.length && <li className="muted small">Nenhum canal encontrado.</li>}
        </ul>
        <p className="muted small">A mensagem vai para o fim do canal escolhido, com autor, data, respostas e anexos.</p>
      </div>
    </Modal>
  );
}

/** Painel de mensagens fixadas do canal. */
function PinsPanel({ channelId, identities, onJump, onClose }: { channelId: string; identities: Map<string, Identity>; onJump: (id: string) => void; onClose: () => void }) {
  const [list, setList] = useState<Message[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Message[]>(`/api/channels/${channelId}/pins`).then(setList).catch((e) => setErr((e as Error).message)); }, [channelId]);
  return (
    <Modal title="Mensagens fixadas" onClose={onClose} width={520}>
      {err && <p className="form-error">{err}</p>}
      {!list && !err && <p className="muted">Carregando…</p>}
      {list && !list.length && <p className="muted">Nenhuma mensagem fixada neste canal. Use “Fixar mensagem” no menu de uma mensagem.</p>}
      <div className="pins">
        {list?.map((m) => {
          const idn = m.identity_id ? identities.get(m.identity_id) : undefined;
          return (
            <button key={m.id} className="pin" onClick={() => onJump(m.id)}>
              <Avatar identity={idn} size={28} />
              <span className="pin__body">
                <span className="pin__head"><b style={{ color: idn?.color ?? undefined }}>{idn?.name ?? 'Sem autor'}</b><small>{fmtFull.format(new Date(m.display_at))}</small></span>
                <span className="pin__text">{plainText(m.content).slice(0, 220) || 'anexo'}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
