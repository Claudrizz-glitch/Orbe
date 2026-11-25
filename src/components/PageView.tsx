'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Channel } from '@/lib/types';
import { uploadAttachment, uploadPage } from '@/lib/client/upload';
import { Modal } from './ui/Modal';
import { useToast } from './ui/Toasts';
import { useConfirm } from './ui/ConfirmDialog';
import { IconClock, IconDownload, IconEdit, IconExternal, IconFolder, IconPaperclip } from './ui/Icons';
import { api } from '@/lib/client/api';
import { PageHistory } from './PageHistory';
import { PageFiles, loadPageFiles } from './PageFiles';
import { FileViewer, viewKind } from './FileViewer';
import type { Attachment } from '@/lib/types';
import { SANDBOX, fileHref } from './FileViewer';
import { estaOffline, notarResposta } from '@/lib/client/offline';

interface Props {
  channel: Channel;
  onChannelUpdated: (c: Channel) => void;
  onConvertToChat: () => void;
}

const TEMPLATE = (title: string) => `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[<>&"]/g, '')}</title>
<style>
  body { margin: 0; font: 16px/1.65 system-ui, sans-serif; background: #0e1017; color: #e7e6ef; }
  main { max-width: 760px; margin: 0 auto; padding: 48px 24px; }
  h1 { font-family: Georgia, serif; font-weight: 500; font-size: 2.2rem; margin: 0 0 12px; }
  h2 { font-family: Georgia, serif; font-weight: 500; margin-top: 32px; }
  a { color: #a99cff; }
  .card { padding: 16px 20px; border-radius: 12px; background: #161924; box-shadow: 0 0 0 1px rgba(255,255,255,.07); }
</style>
</head>
<body>
<main>
  <h1>${title.replace(/[<>&"]/g, '')}</h1>
  <p>Escreva aqui. Esta página pode ter HTML, CSS e JavaScript — ela roda isolada dentro do ORBE.</p>
  <div class="card">
    <h2>Tópico</h2>
    <ul><li>Item</li><li>Item</li></ul>
  </div>
</main>
</body>
</html>
`;

export function PageView({ channel, onChannelUpdated, onConvertToChat }: Props) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const confirm = useConfirm();
  // Servida pelo ORBE com um localStorage próprio: o que a página salva fica guardado aqui
  const src = channel.page_path ? `/api/channels/${channel.id}/page/view?v=${encodeURIComponent(channel.page_path)}` : null;
  const frame = useRef<HTMLIFrameElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error' | 'offline'>('idle');
  // A página é buscada pelo ORBE e exibida via srcdoc (continua isolada pelo sandbox):
  // assim a última versão fica guardada no aparelho e abre mesmo sem internet.
  const [doc, setDoc] = useState<string | null>(null);
  const [docErr, setDocErr] = useState<string | null>(null);
  useEffect(() => {
    if (!src) return;
    let vivo = true;
    setDoc(null); setDocErr(null);
    fetch(src, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (r) => {
        notarResposta(r);
        if (r.status === 401) { window.location.href = '/login'; return; }
        if (!r.ok) throw new Error(r.status === 503 ? 'off' : 'erro');
        const t = await r.text();
        if (vivo) setDoc(t);
      })
      .catch((e) => { if (vivo) setDocErr((e as Error).message === 'erro' ? 'Não foi possível abrir a página.' : 'Sem conexão, e esta página ainda não foi aberta neste aparelho.'); });
    return () => { vivo = false; };
  }, [src, frameKey]);
  const [showFiles, setShowFiles] = useState(false);
  const [viewFile, setViewFile] = useState<Attachment | null>(null);
  const [fileCount, setFileCount] = useState(0);
  const refreshCount = () => { loadPageFiles(channel.id).then((r) => setFileCount(r.files.length)).catch(() => {}); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refreshCount, [channel.id]);

  // Recebe os dados que a página grava e salva no ORBE (com histórico)
  useEffect(() => {
    let pending: Record<string, string> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inflight = Promise.resolve();
    let avisado = false;
    const flush = () => {
      timer = null;
      const items = pending; pending = null;
      if (!items) return;
      // Offline o ORBE é só leitura: o que a página mudar agora não é enviado
      if (estaOffline()) { setSaveState('offline'); if (!avisado) { avisado = true; toast.error('Sem conexão: o que você mudar nesta página não será salvo.'); } return; }
      setSaveState('saving');
      inflight = inflight.then(() => api(`/api/channels/${channel.id}/page/state`, { method: 'PUT', body: { items } })
        .then(() => setSaveState('saved'))
        .catch(() => { setSaveState('error'); toast.error('A página não conseguiu salvar no ORBE. Tente de novo.'); }));
    };
    // Lista dos arquivos da página, reaproveitada entre pedidos (a página pode pedir dezenas de imagens)
    let filesCache: ReturnType<typeof loadPageFiles> | null = null;
    const pageFiles = () => (filesCache ??= loadPageFiles(channel.id).catch((err) => { filesCache = null; throw err; }));
    const onMsg = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data as { orbe?: string; items?: unknown; id?: number; args?: { id?: string; name?: string; type?: string; blob?: unknown } | null };
      const win = frame.current.contentWindow;
      const reply = (result: unknown, error?: string) => win?.postMessage({ orbe: 'reply', id: d.id, result, error }, '*');
      // Ler um arquivo da página (a página é isolada e não acessa /api/files: recebe o conteúdo)
      if (d?.orbe === 'read') {
        pageFiles().then(async ({ files }) => {
          const a = files.find((x) => x.id === d.args?.id);
          if (!a) { reply(null, 'Arquivo não encontrado nesta página.'); return; }
          const r = await fetch(fileHref(a.storage_path), { credentials: 'same-origin' });
          if (!r.ok) throw new Error();
          reply({ blob: await r.blob(), name: a.file_name, type: a.mime_type, size: a.size_bytes });
        }).catch(() => reply(null, 'Não foi possível ler o arquivo.'));
        return;
      }
      // Guardar um arquivo enviado pela página (ex.: a capa de uma obra) nos arquivos dela
      if (d?.orbe === 'upload') {
        const blob = d.args?.blob;
        if (!(blob instanceof Blob)) { reply(null, 'Arquivo inválido.'); return; }
        const name = String(d.args?.name || 'arquivo').slice(0, 200);
        api<{ message_id: string }>(`/api/channels/${channel.id}/page/files`, { method: 'POST' })
          .then(({ message_id }) => uploadAttachment(message_id, new File([blob], name, { type: blob.type || d.args?.type || 'application/octet-stream' })))
          .then((a) => { filesCache = null; refreshCount(); reply({ id: a.id, name: a.file_name, type: a.mime_type, size: a.size_bytes }); })
          .catch((err) => reply(null, (err as Error).message || 'Não foi possível enviar o arquivo.'));
        return;
      }
      // Pedidos da página: listar e abrir os arquivos dela
      if (d?.orbe === 'files' || d?.orbe === 'open') {
        filesCache = null;
        pageFiles().then(({ files }) => {
          if (d.orbe === 'files') {
            reply(files.map((a) => ({ id: a.id, name: a.file_name, type: a.mime_type, size: a.size_bytes, kind: viewKind(a) })));
            return;
          }
          const a = files.find((x) => x.id === d.args?.id);
          if (!a) { reply(null, 'Arquivo não encontrado nesta página.'); return; }
          setViewFile(a);
          reply(true);
        }).catch(() => reply(null, 'Não foi possível consultar os arquivos.'));
        return;
      }
      if (d?.orbe !== 'storage' || !d.items || typeof d.items !== 'object') return;
      pending = d.items as Record<string, string>;
      if (!timer) timer = setTimeout(flush, 400);
    };
    window.addEventListener('message', onMsg);
    return () => { window.removeEventListener('message', onMsg); if (timer) { clearTimeout(timer); flush(); } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  useEffect(() => { setSlot(document.getElementById('chan-actions')); }, []);

  async function save(blob: Blob, ok: string) {
    setBusy('Salvando…');
    try {
      const ch = await uploadPage(channel.id, blob, (p) => setBusy(`Salvando… ${Math.round(p * 100)}%`));
      onChannelUpdated(ch);
      setFrameKey((k) => k + 1);
      toast.success(ok);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function openEditor() {
    if (!channel.page_path) { setEditing(TEMPLATE(channel.name)); return; }
    setBusy('Abrindo o código…');
    try {
      const r = await fetch(fileHref(channel.page_path), { credentials: 'same-origin' });
      if (!r.ok) throw new Error();
      const blob = await r.blob();
      if (blob.size > 3 * 1024 * 1024) { toast.error('Página grande demais para editar aqui. Edite o arquivo no computador e use “Substituir arquivo”.'); return; }
      setEditing(await blob.text());
    } catch { toast.error('Não foi possível abrir o código da página.'); }
    finally { setBusy(null); }
  }

  async function pickFile(f: File | undefined) {
    if (!f) return;
    if (!/\.html?$/i.test(f.name) && !f.type.includes('html')) { toast.error('Escolha um arquivo .html'); return; }
    if (channel.page_path && !(await confirm({ title: 'Substituir a página?', confirmLabel: 'Substituir', message: <p>O conteúdo atual de <b>#{channel.name}</b> será trocado por “{f.name}”.</p> }))) return;
    await save(f, 'Página atualizada.');
  }

  const actions = slot && createPortal(
    <>
      {busy && <span className="hbtn"><span className="spinner" /><span>{busy}</span></span>}
      {src && saveState !== 'idle' && <span className="hbtn page__saved" title="Os dados desta página ficam salvos no ORBE">{saveState === 'saving' ? 'Salvando…' : saveState === 'offline' ? 'Offline · não salvo' : saveState === 'error' ? 'Não salvo' : 'Salvo no ORBE'}</span>}
      {src && <button className="hbtn" onClick={() => setShowFiles(true)} title="Arquivos da página: PDFs e anexos que ela pode abrir"><IconFolder size={16} /><span>Arquivos{fileCount ? ` (${fileCount})` : ''}</span></button>}
      {src && <button className="hbtn" onClick={() => setShowHistory(true)} title="Histórico dos dados salvos pela página"><IconClock size={16} /><span>Histórico</span></button>}
      <button className="hbtn" onClick={openEditor} title="Editar o código HTML desta página"><IconEdit size={16} /><span>Editar HTML</span></button>
      <button className="hbtn" onClick={() => file.current?.click()} title="Trocar por um arquivo .html do seu computador"><IconPaperclip size={16} /><span>Substituir arquivo</span></button>
      {src && <a className="hbtn" href={src} target="_blank" rel="noreferrer" title="Abrir em nova aba"><IconExternal size={16} /></a>}
      {channel.page_path && <a className="hbtn" href={`${fileHref(channel.page_path)}?download=${encodeURIComponent(channel.name)}.html`} title="Baixar o HTML"><IconDownload size={16} /></a>}
    </>,
    slot,
  );

  return (
    <>
      {actions}
      <input ref={file} type="file" accept=".html,.htm,text/html" hidden onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ''; }} />
      {src ? (
        <div className="page">
          {doc !== null
            ? <iframe ref={frame} key={frameKey} className="page__frame" srcDoc={doc} sandbox={SANDBOX} title={channel.name} />
            : <div className="empty">{docErr ? <p>{docErr}</p> : <span className="spinner" />}</div>}
        </div>
      ) : (
        <div className="main__body">
          <div className="empty">
            <div className="empty__chan">📄</div>
            <h3>#{channel.name} é uma página</h3>
            <p>Em vez de mensagens, este canal exibe um documento HTML — notas de estudo, roteiros formatados, painéis, o que você quiser.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="btn btn--primary" onClick={() => file.current?.click()}><IconPaperclip size={15} /> Enviar arquivo .html</button>
              <button className="btn" onClick={openEditor}><IconEdit size={15} /> Escrever HTML</button>
            </div>
            <button className="link-btn" style={{ marginTop: 10 }} onClick={onConvertToChat}>Voltar a ser um canal de conversa</button>
          </div>
        </div>
      )}

      {showFiles && <PageFiles channelId={channel.id} onClose={() => setShowFiles(false)} onOpen={(a) => setViewFile(a)} onChanged={refreshCount} />}
      {viewFile && <FileViewer attachment={viewFile} onClose={() => setViewFile(null)} />}
      {showHistory && <PageHistory channelId={channel.id} onClose={() => setShowHistory(false)} onRestored={() => setFrameKey((k) => k + 1)} />}

      {editing !== null && (
        <Modal title={`Editar HTML · #${channel.name}`} onClose={() => { if (!busy) setEditing(null); }} width={980}
          footer={<>
            <span className="muted small" style={{ marginRight: 'auto' }}>Ctrl+S salva · scripts rodam isolados</span>
            <button className="btn" onClick={() => setEditing(null)} disabled={!!busy}>Cancelar</button>
            <button className="btn btn--primary" disabled={!!busy}
              onClick={async () => { if (await save(new Blob([editing], { type: 'text/html' }), 'Página salva.')) setEditing(null); }}>
              {busy ?? 'Salvar página'}
            </button>
          </>}>
          <textarea className="code" value={editing} spellCheck={false} autoFocus
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={async (e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                if (await save(new Blob([editing], { type: 'text/html' }), 'Página salva.')) setEditing(null);
              }
              if (e.key === 'Tab') {
                e.preventDefault();
                const t = e.currentTarget; const s = t.selectionStart;
                document.execCommand('insertText', false, '  ');
                t.selectionStart = t.selectionEnd = s + 2;
              }
            }} />
        </Modal>
      )}
    </>
  );
}
