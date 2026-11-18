'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Attachment } from '@/lib/types';
import { humanSize } from '@/lib/client/upload';
import { renderMarkdown } from '@/lib/markdown';
import { IconClose, IconDownload, IconExternal } from './ui/Icons';

export const fileHref = (path: string) => `/api/files/${path.split('/').map(encodeURIComponent).join('/')}`;

/** Atributos do iframe isolado: scripts rodam, mas sem acesso à origem do ORBE. */
export const SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads';

export type ViewKind = 'html' | 'pdf' | 'text' | 'markdown' | 'video' | 'audio' | 'image' | null;

const TEXT_EXT = new Set(['txt', 'csv', 'tsv', 'json', 'xml', 'yml', 'yaml', 'log', 'ini', 'js', 'ts', 'tsx', 'jsx', 'css', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'sql', 'sh', 'bat', 'srt']);

export function viewKind(a: Pick<Attachment, 'file_name' | 'mime_type'>): ViewKind {
  const ext = a.file_name.split('.').pop()?.toLowerCase() ?? '';
  const t = a.mime_type.toLowerCase();
  if (ext === 'html' || ext === 'htm' || t.includes('html')) return 'html';
  if (ext === 'pdf' || t === 'application/pdf') return 'pdf';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (t.startsWith('image/') && !t.includes('svg')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (TEXT_EXT.has(ext) || t.startsWith('text/')) return 'text';
  return null;
}

interface Props {
  attachment: Attachment;
  onClose: () => void;
  onMakePage?: (a: Attachment) => void;
}

const MAX_TEXT = 3 * 1024 * 1024;

export function FileViewer({ attachment: a, onClose, onMakePage }: Props) {
  const kind = viewKind(a);
  const url = fileHref(a.storage_path);
  const [text, setText] = useState<string | null>(null);
  const [rendered, setRendered] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  useEffect(() => {
    if (kind !== 'text' && kind !== 'markdown') return;
    if (a.size_bytes > MAX_TEXT) { setErr('Arquivo grande demais para pré-visualizar. Baixe para abrir.'); return; }
    fetch(url, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(setText)
      .catch(() => setErr('Não foi possível carregar o arquivo.'));
  }, [kind, url, a.size_bytes]);

  const openHref = kind === 'html' ? `${url}?view=1` : url;

  return createPortal(
    <div className="fv" role="dialog" aria-modal="true" aria-label={a.file_name}>
      <header className="fv__bar">
        <span className="fv__title"><b>{a.file_name}</b><small>{humanSize(a.size_bytes)}{kind === 'html' ? ' · página isolada: scripts rodam sem acesso ao ORBE' : ''}</small></span>
        {kind === 'markdown' && (
          <button className="btn btn--sm btn--ghost" onClick={() => setRendered((r) => !r)}>{rendered ? 'Ver código' : 'Ver formatado'}</button>
        )}
        {kind === 'html' && onMakePage && (
          <button className="btn btn--sm" onClick={() => onMakePage(a)} title="Cria um canal que exibe este HTML como página">Criar página com este arquivo</button>
        )}
        <a className="icon-btn" href={openHref} target="_blank" rel="noreferrer" title="Abrir em nova aba"><IconExternal size={17} /></a>
        <a className="icon-btn" href={`${url}?download=${encodeURIComponent(a.file_name)}`} title="Baixar" aria-label="Baixar"><IconDownload size={18} /></a>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar" title="Fechar (Esc)"><IconClose size={18} /></button>
      </header>
      <div className="fv__body">
        {kind === 'html' && <iframe className="fv__frame fv__frame--page" src={`${url}?view=1`} sandbox={SANDBOX} title={a.file_name} />}
        {kind === 'pdf' && <iframe className="fv__frame" src={url} title={a.file_name} />}
        {kind === 'image' && <img className="fv__img" src={url} alt={a.file_name} />}
        {kind === 'video' && <video className="fv__img" src={url} controls autoPlay />}
        {kind === 'audio' && <audio src={url} controls autoPlay />}
        {(kind === 'text' || kind === 'markdown') && (
          err ? <p className="form-error">{err}</p>
            : text === null ? <span className="spinner" />
              : kind === 'markdown' && rendered
                ? <div className="fv__doc md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
                : <pre className="fv__text">{text}</pre>
        )}
        {kind === null && (
          <div className="empty">
            <h3>Sem pré-visualização</h3>
            <p>Este tipo de arquivo não pode ser aberto dentro do ORBE.</p>
            <a className="btn btn--primary" href={`${url}?download=${encodeURIComponent(a.file_name)}`}><IconDownload size={15} /> Baixar</a>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
