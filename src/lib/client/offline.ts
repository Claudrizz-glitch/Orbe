'use client';

import { useSyncExternalStore } from 'react';

/**
 * Estado "offline" do ORBE: quando o service worker responde com a cópia guardada
 * no aparelho, ele marca a resposta com a data da cópia (cabeçalho x-orbe-copia).
 */
const MARCA = 'x-orbe-copia';
let copiaDe: string | null = null; // data da cópia em uso, ou null quando os dados vêm da rede
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

/** Chamado a cada resposta da API. */
export function notarResposta(res: Response) {
  const c = res.headers.get(MARCA);
  const agora = c && c !== 'nenhuma' ? c : c === 'nenhuma' ? copiaDe ?? '' : null;
  if (agora !== copiaDe) { copiaDe = agora; avisar(); }
}

/** Sem resposta nenhuma (nem da cópia). */
export function notarFalha() {
  if (copiaDe === null) { copiaDe = ''; avisar(); }
}

if (typeof window !== 'undefined') {
  if (!navigator.onLine) copiaDe = '';
  window.addEventListener('online', () => { copiaDe = null; avisar(); });
  window.addEventListener('offline', () => { if (copiaDe === null) copiaDe = ''; avisar(); });
}

function assinar(f: () => void) { ouvintes.add(f); return () => { ouvintes.delete(f); }; }

/** null = online; '' = offline sem data; ISO = offline mostrando a cópia daquela hora. */
export function useOffline(): string | null {
  return useSyncExternalStore(assinar, () => copiaDe, () => null);
}

export const estaOffline = () => copiaDe !== null || (typeof navigator !== 'undefined' && !navigator.onLine);

/** Apaga a cópia guardada no aparelho (ao sair). */
export async function apagarCopiaLocal() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ orbe: 'apagar-copia' });
    if ('caches' in window) await Promise.all(['orbe-dados', 'orbe-arquivos'].map((k) => caches.delete(k)));
  } catch { /* sem suporte */ }
}
