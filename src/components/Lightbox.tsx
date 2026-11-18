'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Attachment } from '@/lib/types';
import { humanSize } from '@/lib/client/upload';
import { IconChevronLeft, IconChevronRight, IconClose, IconDownload, IconExternal } from './ui/Icons';

export const fileHref = (path: string) => `/api/files/${path.split('/').map(encodeURIComponent).join('/')}`;
export const downloadHref = (a: Attachment) => `${fileHref(a.storage_path)}?download=${encodeURIComponent(a.file_name)}`;

interface Props {
  images: Attachment[];
  start: number;
  onClose: () => void;
  caption?: (a: Attachment) => string | undefined;
}

/** Visualizador de imagens em tela cheia, com navegação e download. */
export function Lightbox({ images, start, onClose, caption }: Props) {
  const [i, setI] = useState(start);
  const [loaded, setLoaded] = useState(false);
  const touch = useRef<number | null>(null);
  const a = images[i];
  const go = (d: number) => { setLoaded(false); setI((x) => (x + d + images.length) % images.length); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && images.length > 1) go(1);
      if (e.key === 'ArrowLeft' && images.length > 1) go(-1);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length]);

  // Pré-carrega as vizinhas
  useEffect(() => {
    for (const d of [1, -1]) {
      const n = images[(i + d + images.length) % images.length];
      if (n) { const img = new Image(); img.src = fileHref(n.storage_path); }
    }
  }, [i, images]);

  if (!a) return null;
  return createPortal(
    <div className="lb" role="dialog" aria-modal="true" aria-label={a.file_name}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touch.current === null || images.length < 2) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}>
      <header className="lb__bar">
        <span className="lb__title">
          <b>{a.file_name}</b>
          <small>{[images.length > 1 ? `${i + 1} de ${images.length}` : null, humanSize(a.size_bytes), a.width && a.height ? `${a.width}×${a.height}` : null, caption?.(a)].filter(Boolean).join(' · ')}</small>
        </span>
        <a className="icon-btn" href={fileHref(a.storage_path)} target="_blank" rel="noreferrer" title="Abrir em nova aba"><IconExternal size={17} /></a>
        <a className="icon-btn" href={downloadHref(a)} title="Baixar" aria-label="Baixar imagem"><IconDownload size={18} /></a>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar" title="Fechar (Esc)"><IconClose size={18} /></button>
      </header>
      {images.length > 1 && <button className="lb__nav lb__nav--prev" onClick={() => go(-1)} aria-label="Anterior"><IconChevronLeft size={22} /></button>}
      <img key={a.id} className={`lb__img ${loaded ? 'is-loaded' : ''}`} src={fileHref(a.storage_path)} alt={a.file_name} onLoad={() => setLoaded(true)} />
      {!loaded && <span className="spinner lb__spin" />}
      {images.length > 1 && <button className="lb__nav lb__nav--next" onClick={() => go(1)} aria-label="Próxima"><IconChevronRight size={22} /></button>}
    </div>,
    document.body,
  );
}
