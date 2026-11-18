'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/client/api';
import { buildExport, type ExportOptions } from '@/lib/client/exportHtml';
import { downloadBlob } from '@/lib/client/zip';
import type { Category, Channel, ExportData, Space } from '@/lib/types';
import { Modal } from './ui/Modal';
import { IconChevron, IconHash } from './ui/Icons';

export type ExportRequest =
  | { kind: 'messages'; ids: string[]; title: string; from: string }
  | { kind: 'channels'; channelIds: string[]; title: string };

interface Props {
  request: ExportRequest;
  spaces: Space[];
  categories: Category[];
  channels: Channel[];
  onClose: () => void;
  onDone: (msg: string) => void;
}

/** Caixa com estado "parcial" (alguns filhos marcados). */
function Tri({ state, onChange, label }: { state: 'all' | 'some' | 'none'; onChange: (on: boolean) => void; label: string }) {
  return (
    <input type="checkbox" aria-label={label} checked={state === 'all'}
      ref={(el) => { if (el) el.indeterminate = state === 'some'; }}
      onChange={(e) => onChange(e.target.checked)} />
  );
}

export function ExportDialog({ request, spaces, categories, channels, onClose, onDone }: Props) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(request.kind === 'channels' ? request.channelIds : []));
  const [open, setOpen] = useState<Set<string>>(() => {
    if (request.kind !== 'channels') return new Set();
    return new Set(channels.filter((c) => request.channelIds.includes(c.id)).map((c) => c.space_id));
  });
  const [opts, setOpts] = useState<ExportOptions>({ title: request.title, format: 'zip', theme: 'auto', showDates: true, showAvatars: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byPos = <T extends { position: number }>(a: T, b: T) => a.position - b.position;
  const tree = useMemo(() => [...spaces].sort(byPos).map((s) => ({
    space: s,
    loose: channels.filter((c) => c.space_id === s.id && !c.category_id).sort(byPos),
    cats: categories.filter((c) => c.space_id === s.id).sort(byPos).map((cat) => ({
      cat, chans: channels.filter((c) => c.category_id === cat.id).sort(byPos),
    })),
  })), [spaces, categories, channels]);

  const stateOf = (ids: string[]) => {
    const n = ids.filter((id) => picked.has(id)).length;
    return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
  };
  const setMany = (ids: string[], on: boolean) => setPicked((p) => {
    const next = new Set(p);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    return next;
  });

  async function run() {
    setError(null);
    try {
      setBusy('Reunindo as mensagens…');
      const body = request.kind === 'messages' ? { message_ids: request.ids } : { channel_ids: [...picked] };
      const data = await api<ExportData>('/api/export', { method: 'POST', body });
      if (!data.messages.length) { setError('Não há mensagens para exportar nessa seleção.'); setBusy(null); return; }
      const out = await buildExport(data, { ...opts, title: opts.title.trim() || 'Exportação do ORBE' }, setBusy);
      downloadBlob(out.blob, out.filename);
      onDone(`${out.filename} gerado (${data.messages.length} mensagens${out.skipped ? `; ${out.skipped} arquivo(s) não incluído(s)` : ''}).`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const count = request.kind === 'messages' ? request.ids.length : picked.size;
  const canRun = !busy && count > 0;

  return (
    <Modal title="Exportar" onClose={() => { if (!busy) onClose(); }} width={560}
      footer={<>
        <button className="btn" onClick={onClose} disabled={!!busy}>Cancelar</button>
        <button className="btn btn--primary" onClick={run} disabled={!canRun}>{busy ? 'Gerando…' : opts.format === 'zip' ? 'Exportar .zip' : 'Exportar .html'}</button>
      </>}>
      <div className="form exp">
        {request.kind === 'messages' ? (
          <p className="imp__intro"><strong>{request.ids.length}</strong> {request.ids.length === 1 ? 'mensagem selecionada' : 'mensagens selecionadas'} de <strong>{request.from}</strong>.</p>
        ) : (
          <div className="field">
            <span>Canais <small>({picked.size} selecionado{picked.size === 1 ? '' : 's'})</small></span>
            <div className="xtree">
              {tree.map(({ space, loose, cats }) => {
                const all = [...loose, ...cats.flatMap((c) => c.chans)].map((c) => c.id);
                if (!all.length) return null;
                const isOpen = open.has(space.id);
                return (
                  <div key={space.id} className="xtree__space">
                    <div className="xtree__row xtree__row--space">
                      <button type="button" className={`xtree__tog ${isOpen ? 'is-open' : ''}`} onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(space.id)) n.delete(space.id); else n.add(space.id); return n; })} aria-label={isOpen ? 'Recolher' : 'Expandir'}>
                        <IconChevron size={13} />
                      </button>
                      <label><Tri state={stateOf(all)} onChange={(on) => setMany(all, on)} label={`Espaço ${space.name}`} /><b>{space.name}</b><small>{all.length} canais</small></label>
                    </div>
                    {isOpen && (
                      <div className="xtree__kids">
                        {loose.map((c) => (
                          <label key={c.id} className="xtree__row"><input type="checkbox" checked={picked.has(c.id)} onChange={(e) => setMany([c.id], e.target.checked)} /><IconHash size={13} />{c.name}</label>
                        ))}
                        {cats.map(({ cat, chans }) => chans.length > 0 && (
                          <div key={cat.id}>
                            <label className="xtree__row xtree__row--cat"><Tri state={stateOf(chans.map((c) => c.id))} onChange={(on) => setMany(chans.map((c) => c.id), on)} label={`Categoria ${cat.name}`} />{cat.name}</label>
                            <div className="xtree__kids">
                              {chans.map((c) => (
                                <label key={c.id} className="xtree__row"><input type="checkbox" checked={picked.has(c.id)} onChange={(e) => setMany([c.id], e.target.checked)} /><IconHash size={13} />{c.name}</label>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <label className="field"><span>Título do documento</span>
          <input className="input" value={opts.title} maxLength={140} onChange={(e) => setOpts({ ...opts, title: e.target.value })} />
        </label>

        <div className="field"><span>Formato</span>
          <div className="choices" style={{ marginTop: 0 }}>
            <label className={`choice ${opts.format === 'zip' ? 'is-on' : ''}`}>
              <input type="radio" name="fmt" checked={opts.format === 'zip'} onChange={() => setOpts({ ...opts, format: 'zip' })} />
              <span><strong>ZIP com anexos</strong><small>index.html + pastas com imagens, arquivos e avatares. Abra o index.html depois de extrair.</small></span>
            </label>
            <label className={`choice ${opts.format === 'single' ? 'is-on' : ''}`}>
              <input type="radio" name="fmt" checked={opts.format === 'single'} onChange={() => setOpts({ ...opts, format: 'single' })} />
              <span><strong>HTML único</strong><small>Um só arquivo, com imagens embutidas. Ótimo para enviar; arquivos acima de 10 MB ficam de fora.</small></span>
            </label>
          </div>
        </div>

        <div className="exp__row">
          <label className="field"><span>Tema</span>
            <select className="input" value={opts.theme} onChange={(e) => setOpts({ ...opts, theme: e.target.value as ExportOptions['theme'] })}>
              <option value="auto">Automático (segue o leitor)</option>
              <option value="light">Claro</option>
              <option value="dark">Escuro</option>
            </select>
          </label>
          <div className="field"><span>Mostrar</span>
            <label className="check"><input type="checkbox" checked={opts.showDates} onChange={(e) => setOpts({ ...opts, showDates: e.target.checked })} /><span>Datas e horários</span></label>
            <label className="check"><input type="checkbox" checked={opts.showAvatars} onChange={(e) => setOpts({ ...opts, showAvatars: e.target.checked })} /><span>Avatares</span></label>
          </div>
        </div>

        <p className="muted small">A exportação só lê os dados — nada é alterado no ORBE. Quem receber o arquivo não precisa de conta.</p>
        {busy && <p className="exp__busy"><span className="spinner" /> {busy}</p>}
        {error && <p className="form-error">{error}</p>}
      </div>
    </Modal>
  );
}
