'use client';

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { applyFormat, SHORTCUTS, type FormatKind } from '@/lib/client/format';
import { renderMarkdown } from '@/lib/markdown';

export interface EditorHandle { focus: () => void }

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Enter envia (Shift+Enter quebra linha). Em telas de toque, Enter sempre quebra linha. */
  enterSends?: boolean;
  /** Elementos à esquerda da barra (ex.: seletor de identidade) */
  leading?: ReactNode;
  /** Elementos à direita da barra (ex.: botão enviar) */
  trailing?: ReactNode;
  compact?: boolean;
  /** Arquivos colados (ex.: captura de tela com Ctrl+V) */
  onPasteFiles?: (files: File[]) => void;
}

const TOOLS: { kind: FormatKind; label: string; title: string; glyph: ReactNode }[] = [
  { kind: 'bold', label: 'Negrito', title: 'Negrito (Ctrl+B)', glyph: <b>B</b> },
  { kind: 'italic', label: 'Itálico', title: 'Itálico (Ctrl+I)', glyph: <i style={{ fontFamily: 'Georgia, serif' }}>I</i> },
  { kind: 'underline', label: 'Sublinhado', title: 'Sublinhado (Ctrl+U)', glyph: <u>U</u> },
  { kind: 'strike', label: 'Tachado', title: 'Tachado (Ctrl+Shift+X)', glyph: <s>S</s> },
  { kind: 'h1', label: 'Título', title: 'Título', glyph: <span>H1</span> },
  { kind: 'h2', label: 'Subtítulo', title: 'Subtítulo', glyph: <span>H2</span> },
  { kind: 'ul', label: 'Lista', title: 'Lista', glyph: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r=".9" fill="currentColor" /><circle cx="4.5" cy="12" r=".9" fill="currentColor" /><circle cx="4.5" cy="18" r=".9" fill="currentColor" /></svg> },
  { kind: 'ol', label: 'Lista numerada', title: 'Lista numerada', glyph: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M10 6h10M10 12h10M10 18h10M4 4.5h1.5V9M3.5 15h2.5L3.5 19h2.5" /></svg> },
  { kind: 'quote', label: 'Citação', title: 'Citação', glyph: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 5v14M10 8h9M10 12h9M10 16h6" /></svg> },
  { kind: 'code', label: 'Código', title: 'Código (Ctrl+E)', glyph: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m8 7-5 5 5 5M16 7l5 5-5 5" /></svg> },
  { kind: 'codeblock', label: 'Bloco de código', title: 'Bloco de código', glyph: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="m9 10-2 2 2 2M15 10l2 2-2 2" /></svg> },
  { kind: 'spoiler', label: 'Spoiler', title: 'Spoiler', glyph: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-2.4 3M6.3 7.4C4.2 9 3 12 3 12s4 6 9 6a8.7 8.7 0 0 0 4.2-1.1" /></svg> },
  { kind: 'link', label: 'Link', title: 'Link (Ctrl+K)', glyph: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" /></svg> },
  { kind: 'hr', label: 'Separador', title: 'Separador', glyph: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 12h16" /></svg> },
];

export const MarkdownEditor = forwardRef<EditorHandle, Props>(function MarkdownEditor(
  { value, onChange, onSubmit, onCancel, placeholder, autoFocus, enterSends = true, leading, trailing, compact, onPasteFiles }, ref,
) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [coarse, setCoarse] = useState(false);

  useImperativeHandle(ref, () => ({ focus: () => ta.current?.focus() }), []);
  useEffect(() => { setCoarse(window.matchMedia('(pointer: coarse)').matches); }, []);
  useEffect(() => {
    if (!autoFocus || !ta.current) return;
    ta.current.focus();
    ta.current.setSelectionRange(ta.current.value.length, ta.current.value.length);
  }, [autoFocus]);

  // Altura automática
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.45))}px`;
  }, [value, preview]);

  function format(kind: FormatKind) {
    if (preview) setPreview(false);
    requestAnimationFrame(() => { if (ta.current) applyFormat(ta.current, kind); });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (e.shiftKey && k === 'x') { e.preventDefault(); applyFormat(e.currentTarget, 'strike'); return; }
      if (!e.shiftKey && SHORTCUTS[k]) { e.preventDefault(); applyFormat(e.currentTarget, SHORTCUTS[k]); return; }
      if (k === 'enter' && onSubmit) { e.preventDefault(); onSubmit(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !mod && enterSends && !coarse && onSubmit) {
      // Dentro de um bloco de código aberto, Enter quebra linha
      const before = e.currentTarget.value.slice(0, e.currentTarget.selectionStart);
      if ((before.match(/```/g)?.length ?? 0) % 2 === 1) return;
      e.preventDefault();
      onSubmit();
      return;
    }
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); }
  }

  return (
    <div className={`editor ${compact ? 'editor--compact' : ''}`}>
      <div className="editor__bar" role="toolbar" aria-label="Formatação">
        {leading}
        <div className="editor__tools">
          {TOOLS.map((t) => (
            <button key={t.kind} type="button" className="tool" title={t.title} aria-label={t.label}
              onMouseDown={(e) => e.preventDefault()} onClick={() => format(t.kind)}>{t.glyph}</button>
          ))}
          <span className="tool-sep" />
          <button type="button" className={`tool ${preview ? 'is-on' : ''}`} title="Pré-visualizar" aria-pressed={preview}
            onMouseDown={(e) => e.preventDefault()} onClick={() => setPreview((p) => !p)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
          </button>
        </div>
        {trailing}
      </div>
      {preview ? (
        <div className="editor__preview md" onClick={() => setPreview(false)}
          dangerouslySetInnerHTML={{ __html: value.trim() ? renderMarkdown(value) : '<p class="muted">Nada para pré-visualizar.</p>' }} />
      ) : (
        <textarea
          ref={ta}
          className="editor__input"
          value={value}
          rows={1}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length && onPasteFiles) { e.preventDefault(); onPasteFiles(files); }
          }}
          spellCheck
        />
      )}
    </div>
  );
});
