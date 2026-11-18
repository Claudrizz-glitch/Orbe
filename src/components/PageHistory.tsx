'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { Modal } from './ui/Modal';
import { useConfirm } from './ui/ConfirmDialog';
import { useToast } from './ui/Toasts';

interface Change { key: string; before: string | null; after: string | null; note?: string }
interface Entry { id: string; at: string; items: Record<string, string>; changes: Change[] }

const fmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

function parse(s: string | null): unknown {
  if (s === null) return null;
  try { return JSON.parse(s); } catch { return s; }
}
const short = (x: unknown) => {
  const t = typeof x === 'string' ? x : JSON.stringify(x);
  return t === undefined ? '—' : t.length > 60 ? `${t.slice(0, 57)}…` : t;
};
const label = (o: Record<string, unknown>) => String(o.name ?? o.title ?? o.nome ?? o.label ?? o.id ?? '?');

/** Descreve uma mudança em linguagem simples (listas de objetos, valores soltos). */
export function describe(c: Change): string[] {
  const a = parse(c.before), b = parse(c.after);
  if (c.before === null) return [`${c.key}: criado`];
  if (c.after === null) return [`${c.key}: removido`];
  const isList = (x: unknown): x is Record<string, unknown>[] => Array.isArray(x) && x.every((i) => i && typeof i === 'object' && !Array.isArray(i));
  if (isList(a) && isList(b)) {
    const keyOf = (o: Record<string, unknown>, i: number) => String(o.id ?? o.name ?? i);
    const A = new Map(a.map((o, i) => [keyOf(o, i), o]));
    const B = new Map(b.map((o, i) => [keyOf(o, i), o]));
    const out: string[] = [];
    for (const [k, o] of B) {
      const p = A.get(k);
      if (!p) { out.push(`+ “${label(o)}” adicionado`); continue; }
      for (const f of new Set([...Object.keys(p), ...Object.keys(o)])) {
        if (JSON.stringify(p[f]) !== JSON.stringify(o[f])) out.push(`“${label(o)}”: ${f} ${short(p[f])} → ${short(o[f])}`);
      }
    }
    for (const [k, o] of A) if (!B.has(k)) out.push(`− “${label(o)}” removido`);
    return out.length ? out : [`${c.key}: reordenado`];
  }
  if (typeof a !== 'object' && typeof b !== 'object') return [`${c.key}: ${short(a)} → ${short(b)}`];
  return [`${c.key}: alterado`];
}

/** Histórico dos dados salvos por uma página HTML, com restauração. */
export function PageHistory({ channelId, onClose, onRestored }: { channelId: string; onClose: () => void; onRestored: () => void }) {
  const [list, setList] = useState<Entry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();

  async function load() {
    try { setList((await api<{ history: Entry[] }>(`/api/channels/${channelId}/page/state`)).history); }
    catch (e) { toast.error((e as Error).message); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [channelId]);

  async function restore(e: Entry) {
    const ok = await confirm({
      title: 'Restaurar esta versão?', confirmLabel: 'Restaurar',
      message: <p>Os dados da página voltam a ser como estavam em <b>{fmt.format(new Date(e.at))}</b>. O estado atual continua no histórico.</p>,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/api/channels/${channelId}/page/state`, { method: 'PUT', body: { items: {}, restore_of: e.id } });
      toast.success('Versão restaurada.');
      onRestored();
      await load();
    } catch (err) { toast.error((err as Error).message); }
    setBusy(false);
  }

  return (
    <Modal title="Histórico de alterações da página" onClose={onClose} width={680}>
      {!list && <p className="muted">Carregando…</p>}
      {list && !list.length && <p className="muted">Nada salvo ainda. Quando a página guardar algo, cada alteração aparece aqui.</p>}
      {list && list.length > 0 && (
        <ol className="phist">
          {list.map((e, i) => {
            const lines = e.changes.flatMap(describe);
            const note = e.changes.find((c) => c.note)?.note;
            return (
              <li key={e.id} className="phist__item">
                <div className="phist__head">
                  <b>{fmt.format(new Date(e.at))}</b>
                  {i === 0 ? <span className="phist__now">atual</span>
                    : <button className="btn btn--sm" disabled={busy} onClick={() => restore(e)}>Restaurar</button>}
                </div>
                {note && <div className="muted small">↺ {note.replace(/restaurado de (.+)/, (_, d: string) => `restaurado da versão de ${fmt.format(new Date(d))}`)}</div>}
                <ul>
                  {lines.slice(0, 8).map((l, j) => <li key={j}>{l}</li>)}
                  {lines.length > 8 && <li className="muted">…e mais {lines.length - 8} alterações</li>}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </Modal>
  );
}
