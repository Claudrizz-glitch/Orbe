'use client';

import { renderMarkdown, plainText } from '../markdown';
import type { Attachment, ExportData, Identity, Message } from '../types';
import { makeZip, uniqueName, type ZipEntry } from './zip';

/**
 * Exportação para HTML independente do ORBE.
 *  - "single": um único .html; imagens e avatares embutidos (data URI),
 *    demais arquivos embutidos até 10 MB cada.
 *  - "zip":    index.html + pastas anexos/ e avatares/, com caminhos relativos
 *    (funciona depois de extraído, em qualquer navegador, sem internet).
 * Nada é alterado no ORBE: os dados são apenas lidos.
 */
export interface ExportOptions {
  title: string;
  format: 'single' | 'zip';
  theme: 'auto' | 'light' | 'dark';
  showDates: boolean;
  showAvatars: boolean;
}

const EMBED_LIMIT = 10 * 1024 * 1024;
const GROUP_MS = 7 * 60 * 1000;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fileUrl = (path: string) => `/api/files/${path.split('/').map(encodeURIComponent).join('/')}`;
const fmtFull = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtLong = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const isImage = (a: Attachment) => a.mime_type.startsWith('image/') && !a.mime_type.includes('svg');
const safeColor = (c: string | null) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : null);

function humanSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

function initials(name: string) {
  const w = name.trim().split(/\s+/);
  return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
}

export function slug(s: string) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'orbe';
}

async function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Busca os arquivos e decide como cada um será referenciado no HTML. */
async function resolveFiles(data: ExportData, opts: ExportOptions, onProgress: (msg: string) => void) {
  const refs = new Map<string, string>();      // storage_path → href usado no HTML
  const notEmbedded = new Set<string>();         // arquivos grandes demais para o HTML único
  const entries: ZipEntry[] = [];
  const used = new Set<string>();

  const wanted: { path: string; name: string; folder: string; size: number; date?: Date }[] = [];
  if (opts.showAvatars) {
    for (const i of data.identities) if (i.avatar_path) wanted.push({ path: i.avatar_path, name: `${slug(i.name)}.${i.avatar_path.split('.').pop()}`, folder: 'avatares', size: 0 });
  }
  const when = new Map(data.messages.map((m) => [m.id, new Date(m.display_at)]));
  for (const a of data.attachments) wanted.push({ path: a.storage_path, name: a.file_name, folder: 'anexos', size: a.size_bytes, date: when.get(a.message_id) });

  let done = 0;
  for (const w of wanted) {
    done++;
    onProgress(`Baixando arquivos ${done}/${wanted.length}…`);
    if (opts.format === 'single' && w.size > EMBED_LIMIT) { notEmbedded.add(w.path); continue; }
    try {
      const res = await fetch(fileUrl(w.path), { credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      if (opts.format === 'single') {
        refs.set(w.path, await toDataUrl(blob));
      } else {
        const name = `${w.folder}/${uniqueName(w.name, used)}`;
        entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()), date: w.date });
        refs.set(w.path, name.split('/').map(encodeURIComponent).join('/'));
      }
    } catch {
      notEmbedded.add(w.path);
    }
  }
  return { refs, notEmbedded, entries };
}

function css(theme: ExportOptions['theme']) {
  const light = `--bg:#fbfaf7;--paper:#fff;--ink:#1d1c22;--soft:#45444f;--muted:#7b7a86;--faint:#a9a8b3;--line:rgba(20,15,40,.09);--accent:#5b4bd1;--quote:rgba(20,15,40,.045);--mix:#000;--mixp:68%;`;
  const dark = `--bg:#0e1017;--paper:#14161f;--ink:#ecebf3;--soft:#c3c2d1;--muted:#8a899c;--faint:#5f5e70;--line:rgba(255,255,255,.07);--accent:#a99cff;--quote:rgba(255,255,255,.04);--mix:#fff;--mixp:88%;`;
  const vars = theme === 'light' ? `:root{${light}}` : theme === 'dark' ? `:root{${dark}color-scheme:dark}` : `:root{${light}}@media (prefers-color-scheme:dark){:root{${dark}color-scheme:dark}}`;
  return `${vars}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.doc{max-width:780px;margin:0 auto;padding:56px 24px 80px}
.doc__mark{font-size:.7rem;letter-spacing:.42em;text-transform:uppercase;color:var(--accent);font-weight:600;margin-bottom:18px}
.doc__head h1{font-family:Georgia,"Iowan Old Style","Times New Roman",serif;font-weight:500;font-size:2.3rem;line-height:1.15;letter-spacing:-.01em;margin:0 0 10px}
.doc__meta{color:var(--muted);font-size:.86rem;margin:0}
.toc{margin:32px 0 8px;padding:16px 20px;border-radius:12px;background:var(--paper);box-shadow:0 0 0 1px var(--line)}
.toc b{display:block;font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:6px}
.toc ol{margin:0;padding-left:20px;columns:2;column-gap:28px}.toc li{font-size:.9rem;padding:2px 0;break-inside:avoid}
.toc a{color:var(--soft);text-decoration:none}.toc a:hover{color:var(--accent)}.toc small{color:var(--faint)}
.ch{margin-top:56px}
.ch__path{display:block;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:4px}
.ch h2{font-family:Georgia,"Iowan Old Style",serif;font-weight:500;font-size:1.6rem;margin:0;letter-spacing:-.01em}
.ch h2 .hash{color:var(--faint);margin-right:2px}
.ch__topic{color:var(--muted);margin:6px 0 0;font-size:.92rem}
.day{display:flex;align-items:center;gap:14px;margin:30px 0 10px;font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}
.day:before,.day:after{content:"";flex:1;height:1px;background:var(--line)}
.m{display:grid;grid-template-columns:44px 1fr;column-gap:14px;padding:8px 0;break-inside:avoid}
.m--cont{padding-top:0}.m--noav{grid-template-columns:1fr}
.m__av{width:40px;height:40px;border-radius:50%;object-fit:cover;background:var(--quote);display:grid;place-items:center;font-size:.8rem;font-weight:600;color:var(--soft);margin-top:3px}
.m__gut{font-size:.68rem;color:var(--faint);text-align:right;padding-top:5px;font-variant-numeric:tabular-nums}
.m__head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.m__name{font-weight:600;color:var(--c,var(--ink));color:color-mix(in srgb,var(--c,var(--ink)) var(--mixp),var(--mix))}
.m__time{font-size:.74rem;color:var(--faint);font-variant-numeric:tabular-nums}
.m__pin{font-size:.68rem;color:#c48a16}
.m__reply{display:block;margin:0 0 4px;padding:2px 0 2px 10px;border-left:2px solid var(--line);font-size:.8rem;color:var(--muted);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.m__reply b{color:var(--soft);font-weight:600}
a.m__reply:hover{color:var(--accent)}
.md{color:var(--soft);overflow-wrap:anywhere}.md p{margin:0}.md strong{color:var(--ink)}
.md a{color:var(--accent)}.md code{font:.86em ui-monospace,"Cascadia Code",Consolas,monospace;background:var(--quote);padding:1px 5px;border-radius:5px}
.md pre{background:var(--quote);padding:12px 14px;border-radius:8px;overflow-x:auto;margin:6px 0}.md pre code{background:none;padding:0}
.md blockquote{margin:4px 0;padding-left:12px;border-left:3px solid var(--line);color:var(--muted)}
.md h1,.md h2,.md h3{font-family:Georgia,serif;font-weight:500;color:var(--ink);margin:10px 0 2px}
.md h1{font-size:1.4rem}.md h2{font-size:1.2rem}.md h3{font-size:1.05rem}
.md ul,.md ol{margin:2px 0;padding-left:22px}.md hr{border:0;height:1px;background:var(--line);margin:12px 0}
.md .spoiler{background:var(--ink);color:transparent;border-radius:3px;cursor:pointer}.md .spoiler:hover,.md .spoiler:focus{color:var(--bg);background:var(--muted)}
.md small.sub{color:var(--muted);font-size:.8em}.md .edited{font-size:.7rem;color:var(--faint);margin-left:6px}
.att{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.att img{display:block;max-width:100%;max-height:520px;border-radius:10px;box-shadow:0 0 0 1px var(--line);background:var(--quote)}
.att__file{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:10px;background:var(--paper);box-shadow:0 0 0 1px var(--line);color:var(--soft);text-decoration:none;font-size:.88rem;max-width:380px}
a.att__file:hover{box-shadow:0 0 0 1px var(--accent)}
.att__file small{display:block;color:var(--faint);font-size:.74rem}
.att__ext{width:34px;height:40px;border-radius:6px;display:grid;place-items:center;background:var(--quote);color:var(--accent);font-size:.6rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;flex:none}
.embed{margin-top:6px;padding:10px 14px;border-left:3px solid var(--ec,var(--line));border-radius:4px 10px 10px 4px;background:var(--paper);box-shadow:0 0 0 1px var(--line);font-size:.88rem;max-width:520px}
.embed b{display:block;color:var(--ink)}
.foot{margin-top:72px;padding-top:18px;border-top:1px solid var(--line);color:var(--faint);font-size:.76rem;text-align:center}
:target>.m__body,.m:target .m__body{background:rgba(169,156,255,.12);border-radius:8px}
@media (max-width:600px){.doc{padding:36px 16px 56px}.doc__head h1{font-size:1.8rem}.toc ol{columns:1}.m{grid-template-columns:36px 1fr;column-gap:10px}.m__av{width:34px;height:34px}}
@media print{body{background:#fff;color:#000}.doc{max-width:none;padding:0}.toc{box-shadow:none;border:1px solid #ddd}.ch{break-before:page}.ch:first-of-type{break-before:auto}a{color:inherit}}`;
}

/** Gera o documento (HTML único ou ZIP) e devolve o arquivo pronto para baixar. */
export async function buildExport(data: ExportData, opts: ExportOptions, onProgress: (msg: string) => void = () => {}): Promise<{ blob: Blob; filename: string; skipped: number }> {
  const { refs, notEmbedded, entries } = await resolveFiles(data, opts, onProgress);
  onProgress('Montando o documento…');

  const idn = new Map<string, Identity>(data.identities.map((i) => [i.id, i]));
  const byId = new Map<string, Message>(data.messages.map((m) => [m.id, m]));
  const outside = new Map(data.replies.map((r) => [r.id, r]));
  const atts = new Map<string, Attachment[]>();
  for (const a of data.attachments) atts.set(a.message_id, [...(atts.get(a.message_id) ?? []), a]);

  const avatar = (i: Identity | undefined) => {
    if (!opts.showAvatars) return '';
    const href = i?.avatar_path ? refs.get(i.avatar_path) : undefined;
    if (href) return `<img class="m__av" src="${esc(href)}" alt="">`;
    const c = safeColor(i?.color ?? null);
    return `<div class="m__av"${c ? ` style="color:${c}"` : ''}>${esc(initials(i?.name ?? '?'))}</div>`;
  };

  const attHtml = (a: Attachment) => {
    const href = refs.get(a.storage_path);
    if (isImage(a) && href) {
      const dims = a.width && a.height ? ` width="${a.width}" height="${a.height}"` : '';
      return `<a href="${esc(href)}" target="_blank" rel="noopener"><img src="${esc(href)}" alt="${esc(a.file_name)}" loading="lazy"${dims}></a>`;
    }
    const ext = a.file_name.includes('.') ? a.file_name.split('.').pop()!.slice(0, 4) : 'arq';
    const inner = `<span class="att__ext">${esc(ext)}</span><span>${esc(a.file_name)}<small>${humanSize(a.size_bytes)}${!href && notEmbedded.has(a.storage_path) ? ' · não incluído (exporte em .zip para levar os arquivos grandes)' : ''}</small></span>`;
    return href
      ? `<a class="att__file" href="${esc(href)}" download="${esc(a.file_name)}">${inner}</a>`
      : `<div class="att__file">${inner}</div>`;
  };

  const sections: string[] = [];
  const multi = data.channels.length > 1;
  for (const ch of data.channels) {
    const list = data.messages.filter((m) => m.channel_id === ch.id);
    if (!list.length) continue;
    const parts: string[] = [];
    let prev: Message | null = null;
    for (const m of list) {
      const i = m.identity_id ? idn.get(m.identity_id) : undefined;
      const d = new Date(m.display_at);
      const newDay = opts.showDates && (!prev || dayKey(prev.display_at) !== dayKey(m.display_at));
      const cont = !!prev && !newDay && !m.reply_to_id && prev.identity_id === m.identity_id
        && Math.abs(d.getTime() - new Date(prev.display_at).getTime()) < GROUP_MS;
      prev = m;
      if (newDay) parts.push(`<div class="day">${esc(fmtDay.format(d))}</div>`);

      let reply = '';
      if (m.reply_to_id) {
        const r = byId.get(m.reply_to_id) ?? outside.get(m.reply_to_id);
        const rn = r?.identity_id ? idn.get(r.identity_id)?.name : undefined;
        const text = r ? esc(plainText(r.content).slice(0, 140) || 'anexo') : 'mensagem original não incluída';
        reply = byId.has(m.reply_to_id)
          ? `<a class="m__reply" href="#m-${m.reply_to_id}"><b>${esc(rn ?? 'Sem autor')}</b> ${text}</a>`
          : `<span class="m__reply">${r ? `<b>${esc(rn ?? 'Sem autor')}</b> ` : ''}${text}</span>`;
      }

      const color = safeColor(i?.color ?? null);
      const head = cont ? '' : `<div class="m__head"><span class="m__name"${color ? ` style="--c:${color}"` : ''}>${esc(i?.name ?? 'Sem autor')}</span>${opts.showDates ? `<time class="m__time" datetime="${m.display_at}" title="${esc(fmtLong.format(d))}">${esc(fmtFull.format(d))}</time>` : ''}${m.pinned_at ? '<span class="m__pin">● fixada</span>' : ''}</div>`;
      const left = !opts.showAvatars ? '' : cont ? `<div class="m__gut">${opts.showDates ? esc(fmtTime.format(d)) : ''}</div>` : avatar(i);
      const embeds = (m.extra?.embeds ?? []).map((e) => {
        const c = typeof e.color === 'number' ? `#${e.color.toString(16).padStart(6, '0')}` : null;
        return `<div class="embed"${c ? ` style="--ec:${c}"` : ''}>${e.author ? `<small>${esc(e.author)}</small>` : ''}${e.title ? (e.url && /^https?:\/\//.test(e.url) ? `<a href="${esc(e.url)}" target="_blank" rel="noopener"><b>${esc(e.title)}</b></a>` : `<b>${esc(e.title)}</b>`) : ''}${e.description ? `<div class="md">${renderMarkdown(e.description)}</div>` : ''}</div>`;
      }).join('');
      const a = atts.get(m.id);
      parts.push(`<article class="m${cont ? ' m--cont' : ''}${opts.showAvatars ? '' : ' m--noav'}" id="m-${m.id}">${left}<div class="m__body">${reply}${head}${m.content ? `<div class="md">${renderMarkdown(m.content)}</div>` : ''}${embeds}${a?.length ? `<div class="att">${a.map(attHtml).join('')}</div>` : ''}</div></article>`);
    }
    const path = [ch.space, ch.category].filter(Boolean).join(' / ');
    sections.push(`<section class="ch" id="c-${ch.id}"><span class="ch__path">${esc(path)}</span><h2><span class="hash">#</span>${esc(ch.name)}</h2>${ch.topic ? `<p class="ch__topic">${esc(ch.topic)}</p>` : ''}${parts.join('')}</section>`);
  }

  const count = data.messages.length;
  const spaces = [...new Set(data.channels.map((c) => c.space))].join(', ');
  const toc = multi ? `<nav class="toc"><b>Canais</b><ol>${data.channels.map((c) => {
    const n = data.messages.filter((m) => m.channel_id === c.id).length;
    return n ? `<li><a href="#c-${c.id}">#${esc(c.name)}</a> <small>${n}</small></li>` : '';
  }).join('')}</ol></nav>` : '';
  const meta = [spaces, `${count} ${count === 1 ? 'mensagem' : 'mensagens'}`, `exportado em ${fmtLong.format(new Date())}`].filter(Boolean).join(' · ');

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="ORBE">
<title>${esc(opts.title)}</title>
<style>${css(opts.theme)}</style>
</head>
<body>
<main class="doc">
<header class="doc__head"><div class="doc__mark">ORBE</div><h1>${esc(opts.title)}</h1><p class="doc__meta">${esc(meta)}</p></header>
${toc}
${sections.join('\n')}
<footer class="foot">Exportado do ORBE · ${esc(fmtLong.format(new Date()))}</footer>
</main>
</body>
</html>`;

  const base = slug(opts.title);
  if (opts.format === 'zip') {
    const blob = makeZip([{ name: 'index.html', data: new TextEncoder().encode(html) }, ...entries]);
    return { blob, filename: `${base}.zip`, skipped: notEmbedded.size };
  }
  return { blob: new Blob([html], { type: 'text/html;charset=utf-8' }), filename: `${base}.html`, skipped: notEmbedded.size };
}
