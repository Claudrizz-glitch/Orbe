'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Channel } from '@/lib/types';
import { uploadPage } from '@/lib/client/upload';
import { Modal } from './ui/Modal';
import { useToast } from './ui/Toasts';
import { useConfirm } from './ui/ConfirmDialog';
import { IconDownload, IconEdit, IconExternal, IconPaperclip } from './ui/Icons';
import { SANDBOX, fileHref } from './FileViewer';

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
  const src = channel.page_path ? `${fileHref(channel.page_path)}?view=1` : null;

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
          <iframe key={frameKey} className="page__frame" src={src} sandbox={SANDBOX} title={channel.name} />
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
