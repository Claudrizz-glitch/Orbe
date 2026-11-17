'use client';

/**
 * Formatação Markdown (dialeto Discord) aplicada à seleção de um <textarea>.
 * Usa execCommand('insertText') quando disponível para manter o Ctrl+Z nativo.
 */
export type FormatKind =
  | 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler' | 'code' | 'codeblock'
  | 'h1' | 'h2' | 'h3' | 'quote' | 'ul' | 'ol' | 'link' | 'hr';

const WRAP: Partial<Record<FormatKind, string>> = {
  bold: '**', italic: '*', underline: '__', strike: '~~', spoiler: '||', code: '`',
};
const PREFIX: Partial<Record<FormatKind, string>> = { h1: '# ', h2: '## ', h3: '### ', quote: '> ', ul: '- ' };

function replaceRange(ta: HTMLTextAreaElement, start: number, end: number, text: string, selStart: number, selEnd: number) {
  ta.focus();
  ta.setSelectionRange(start, end);
  const ok = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
  if (!ok) {
    ta.setRangeText(text, start, end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  ta.setSelectionRange(selStart, selEnd);
}

export function applyFormat(ta: HTMLTextAreaElement, kind: FormatKind) {
  const v = ta.value;
  let s = ta.selectionStart;
  let e = ta.selectionEnd;

  const mark = WRAP[kind];
  if (mark) {
    const sel = v.slice(s, e);
    // Desfaz se a seleção já está envolvida pela marcação
    if (v.slice(s - mark.length, s) === mark && v.slice(e, e + mark.length) === mark) {
      replaceRange(ta, s - mark.length, e + mark.length, sel, s - mark.length, e - mark.length);
      return;
    }
    if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2) {
      const inner = sel.slice(mark.length, sel.length - mark.length);
      replaceRange(ta, s, e, inner, s, s + inner.length);
      return;
    }
    replaceRange(ta, s, e, `${mark}${sel}${mark}`, s + mark.length, e + mark.length);
    return;
  }

  if (kind === 'codeblock') {
    const sel = v.slice(s, e);
    const before = s > 0 && v[s - 1] !== '\n' ? '\n' : '';
    const text = `${before}\`\`\`\n${sel}\n\`\`\`\n`;
    const caret = s + before.length + 4;
    replaceRange(ta, s, e, text, caret, caret + sel.length);
    return;
  }

  if (kind === 'link') {
    const sel = v.slice(s, e);
    if (/^https?:\/\/\S+$/.test(sel)) {
      replaceRange(ta, s, e, `[texto](${sel})`, s + 1, s + 6); // seleciona "texto"
      return;
    }
    const label = sel || 'texto';
    const text = `[${label}](https://)`;
    const urlStart = s + label.length + 3;
    // Sem seleção: seleciona o rótulo; com seleção: seleciona a URL para colar
    replaceRange(ta, s, e, text, sel ? urlStart : s + 1, sel ? urlStart + 8 : s + 1 + label.length);
    return;
  }

  if (kind === 'hr') {
    const before = s > 0 && v[s - 1] !== '\n' ? '\n' : '';
    const text = `${before}---\n`;
    replaceRange(ta, s, e, text, s + text.length, s + text.length);
    return;
  }

  // Prefixos de linha: aplica a todas as linhas da seleção (alterna)
  s = v.lastIndexOf('\n', s - 1) + 1;
  const nl = v.indexOf('\n', e > s && v[e - 1] === '\n' ? e - 1 : e);
  e = nl === -1 ? v.length : nl;
  const lines = v.slice(s, e).split('\n');
  let out: string[];
  if (kind === 'ol') {
    const all = lines.every((l) => /^\d+\. /.test(l));
    out = all ? lines.map((l) => l.replace(/^\d+\. /, '')) : lines.map((l, i) => `${i + 1}. ${l.replace(/^(\d+\. |- |> |#{1,3} )/, '')}`);
  } else {
    const p = PREFIX[kind]!;
    const all = lines.every((l) => l.startsWith(p));
    out = all ? lines.map((l) => l.slice(p.length)) : lines.map((l) => p + l.replace(/^(\d+\. |- |> |#{1,3} )/, ''));
  }
  const text = out.join('\n');
  replaceRange(ta, s, e, text, s, s + text.length);
}

export const SHORTCUTS: Record<string, FormatKind> = { b: 'bold', i: 'italic', u: 'underline', e: 'code', k: 'link' };
