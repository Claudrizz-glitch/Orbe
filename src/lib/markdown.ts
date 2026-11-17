/**
 * Renderizador Markdown no dialeto do Discord → HTML seguro.
 * Todo o texto é escapado ANTES de qualquer transformação; só geramos tags
 * de uma lista fixa e links http(s). Nenhum HTML do conteúdo passa adiante.
 *
 * Suporta: **negrito**, *itálico* ou _itálico_, __sublinhado__, ~~tachado~~,
 * ||spoiler||, `código`, ```blocos```, # títulos, -# subtexto, > citação,
 * >>> citação longa, listas (- * 1.), --- separador, [links](https://…).
 */
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const link = (href: string, text: string) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">${text}</a>`;

function inline(s: string): string {
  return s
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?!\s)(.+?)(?<!\s)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/\|\|(.+?)\|\|/g, '<span class="spoiler" title="Spoiler">$1</span>');
}

export function renderMarkdown(src: string): string {
  const held: string[] = [];
  const hold = (html: string) => `\u0000${held.push(html) - 1}\u0000`;

  let s = src.replace(/\r\n?/g, '\n');
  s = s.replace(/```(?:([\w+#.-]{1,20})\n)?([\s\S]*?)```/g, (_, _lang, code: string) =>
    `\n\u0001${held.push(`<pre><code>${esc(code.replace(/^\n/, '').replace(/\n$/, ''))}</code></pre>`) - 1}\u0001\n`);
  s = s.replace(/`([^`\n]+)`/g, (_, c: string) => hold(`<code>${esc(c)}</code>`));
  s = esc(s);
  s = s.replace(/\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]+)\)/g, (_, t: string, u: string) => hold(link(u, inline(t))));
  s = s.replace(/&lt;(https?:\/\/[^\s]+?)&gt;/g, (_, u: string) => hold(link(u, u)));
  s = s.replace(/https?:\/\/[^\s<\u0000]+[^\s<.,:;"')\]!?\u0000]/g, (u) => hold(link(u, u)));

  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  let quote: string[] = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.tag}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${quote.join('<br>')}</blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  const lines = s.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^\u0001(\d+)\u0001$/))) { flushAll(); out.push(held[Number(m[1])]); continue; }
    if (line === '' && (lines[i - 1]?.startsWith('\u0001') || lines[i + 1]?.startsWith('\u0001'))) continue;
    if ((m = line.match(/^&gt;&gt;&gt; ?(.*)$/))) {
      flushAll();
      out.push(`<blockquote>${[m[1], ...lines.slice(i + 1)].map(inline).join('<br>')}</blockquote>`);
      break;
    }
    if ((m = line.match(/^&gt; ?(.*)$/))) { flushPara(); flushList(); quote.push(inline(m[1])); continue; }
    flushQuote();
    if ((m = line.match(/^(#{1,3}) (.+)$/))) { flushAll(); const n = m[1].length; out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
    if ((m = line.match(/^-# (.+)$/))) { flushAll(); out.push(`<p><small class="sub">${inline(m[1])}</small></p>`); continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushAll(); out.push('<hr>'); continue; }
    if ((m = line.match(/^\s*[-*] (.+)$/))) {
      flushPara();
      if (list?.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
      list.items.push(inline(m[1]));
      continue;
    }
    if ((m = line.match(/^\s*\d{1,3}\. (.+)$/))) {
      flushPara();
      if (list?.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
      list.items.push(inline(m[1]));
      continue;
    }
    flushList();
    para.push(inline(line));
  }
  flushAll();

  let html = out.join('');
  for (let k = 0; k < 3 && html.includes('\u0000'); k++) {
    html = html.replace(/\u0000(\d+)\u0000/g, (_, n: string) => held[Number(n)] ?? '');
  }
  return html;
}

/** Texto puro, sem marcação — para prévias de respostas. */
export function plainText(src: string): string {
  return src.replace(/```[\s\S]*?```/g, '[código]').replace(/[*_~|`#>]/g, '').replace(/\s+/g, ' ').trim();
}
