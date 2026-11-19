import 'server-only';
import { store } from './store';
import { ApiError } from './api';

/**
 * Dados salvos pelas páginas HTML (o "localStorage" delas).
 * A página roda isolada (sandbox, sem acesso ao ORBE), então o ORBE injeta um
 * localStorage próprio que começa com o estado salvo e avisa o ORBE a cada mudança.
 * Cada gravação vira uma linha em page_history (retrato completo + o que mudou),
 * o que permite ver e restaurar versões anteriores.
 */

export type Items = Record<string, string>;
export interface Change { key: string; before: string | null; after: string | null }
export interface HistoryRow { id: string; channel_id: string; at: string; items: Items; changes: Change[] }

const MAX_BYTES = 1024 * 1024;   // dados de uma página
const MAX_KEYS = 500;
const KEEP = 1000;               // versões guardadas por página

export function validItems(v: unknown): Items {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ApiError(400, 'Dados inválidos.');
  const out: Items = {};
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > MAX_KEYS) throw new ApiError(413, 'Dados demais nesta página.');
  for (const [k, val] of entries) {
    if (k.length > 200) throw new ApiError(400, 'Chave longa demais.');
    out[k] = String(val);
  }
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_BYTES) throw new ApiError(413, 'A página tentou salvar mais de 1 MB.');
  return out;
}

export async function currentItems(channelId: string): Promise<Items> {
  const [r] = await store().select<HistoryRow>('page_history', {
    cols: 'items', eq: { channel_id: channelId }, order: [{ col: 'at', asc: false }], limit: 1,
  });
  return r?.items ?? {};
}

export async function history(channelId: string, limit = 300): Promise<HistoryRow[]> {
  return store().select<HistoryRow>('page_history', {
    cols: 'id, at, items, changes', eq: { channel_id: channelId }, order: [{ col: 'at', asc: false }], limit,
  });
}

/** Grava o novo estado se algo mudou; devolve a entrada criada (ou null). */
export async function saveItems(channelId: string, items: Items, note?: string): Promise<HistoryRow | null> {
  const s = store();
  const before = await currentItems(channelId);
  const keys = new Set([...Object.keys(before), ...Object.keys(items)]);
  const changes: (Change & { note?: string })[] = [];
  for (const key of keys) {
    const a = before[key] ?? null, b = items[key] ?? null;
    if (a !== b) changes.push({ key, before: a, after: b });
  }
  if (!changes.length) return null;
  if (note) changes[0].note = note;
  const [row] = await s.insert<HistoryRow>('page_history', [{ channel_id: channelId, at: new Date().toISOString(), items, changes }], { cols: 'id, at, items, changes' });

  // Mantém só as versões mais recentes
  const old = await s.select<{ id: string }>('page_history', { cols: 'id', eq: { channel_id: channelId }, order: [{ col: 'at', asc: false }], offset: KEEP, limit: 500 });
  if (old.length) await s.remove('page_history', { in: { id: old.map((o) => o.id) } });
  return row;
}

/** Script injetado no topo da página: troca o localStorage pelo do ORBE. */
export function storageShim(items: Items, parentOrigin: string): string {
  const json = (x: unknown) => JSON.stringify(x)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<script data-orbe="storage">(function(){
var M=new Map(Object.entries(${json(items)})),T=null,O=${json(parentOrigin)};
function send(){T=null;if(window.parent!==window){try{window.parent.postMessage({orbe:"storage",items:Object.fromEntries(M)},O)}catch(e){}}}
function q(){if(!T)T=setTimeout(send,500)}
var S={getItem:function(k){k=String(k);return M.has(k)?M.get(k):null},setItem:function(k,v){M.set(String(k),String(v));q()},
removeItem:function(k){M.delete(String(k));q()},clear:function(){M.clear();q()},key:function(i){var a=Array.from(M.keys());return i<a.length?a[i]:null},
get length(){return M.size}};
try{Object.defineProperty(window,"localStorage",{configurable:true,get:function(){return S}})}catch(e){}
addEventListener("pagehide",function(){if(T){clearTimeout(T);send()}});
var Q={},N=0,IN=window.parent!==window;
addEventListener("message",function(e){if(e.source!==window.parent)return;var d=e.data;if(d&&d.orbe==="reply"&&Q[d.id]){var q=Q[d.id];delete Q[d.id];if(d.error)q[1](new Error(d.error));else q[0](d.result)}});
function ask(t,a,ms){return new Promise(function(res,rej){if(!IN){rej(new Error("Disponível só dentro do ORBE."));return}var id=++N;Q[id]=[res,rej];
window.parent.postMessage({orbe:t,id:id,args:a||null},O);setTimeout(function(){if(Q[id]){delete Q[id];rej(new Error("O ORBE não respondeu. Recarregue a página do ORBE (Ctrl+F5) e tente de novo."))}},ms||10000)})}
var U={};
window.orbe={inside:IN,files:function(){return ask("files")},open:function(id){return ask("open",{id:String(id)})},
read:function(id){return ask("read",{id:String(id)},30000)},
url:function(id){id=String(id);return U[id]||(U[id]=ask("read",{id:id},30000).then(function(r){return URL.createObjectURL(r.blob)},function(e){delete U[id];throw e}))},
upload:function(blob,name){return ask("upload",{blob:blob,name:String(name||"arquivo"),type:blob&&blob.type},120000)}};
})();</script>`;
}

/** Insere o script logo após <head> (ou no início do documento). */
export function injectShim(html: string, shim: string): string {
  const m = /<head[^>]*>/i.exec(html) ?? /<html[^>]*>/i.exec(html);
  if (m) return html.slice(0, m.index + m[0].length) + shim + html.slice(m.index + m[0].length);
  const dt = /^\s*<!doctype[^>]*>/i.exec(html);
  return dt ? dt[0] + shim + html.slice(dt[0].length) : shim + html;
}
