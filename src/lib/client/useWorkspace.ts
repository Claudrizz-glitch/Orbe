'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Category, Channel, Space, Workspace } from '../types';

export type SyncState = 'idle' | 'saving' | 'error' | 'offline';

export interface SpaceInput { name: string; icon: string | null; color: string | null }
export interface CategoryInput { name: string; icon: string | null; color: string | null }
export interface ChannelInput {
  name: string; icon: string | null; color: string | null; topic: string | null; category_id: string | null;
}

const byPos = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

/**
 * Estado do espaço de trabalho (espaços, categorias, canais).
 * Fonte da verdade: o banco. Criações e edições aguardam o servidor;
 * reordenações e recolhimentos são otimistas, com reversão em caso de erro.
 */
export function useWorkspace(initial: Workspace) {
  const [ws, setWs] = useState<Workspace>(initial);
  const [pending, setPending] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const wsRef = useRef(ws);
  wsRef.current = ws;

  const track = useCallback(async <T,>(p: Promise<T>): Promise<T> => {
    setPending((n) => n + 1);
    try {
      const r = await p;
      setLastError(null);
      return r;
    } catch (e) {
      setLastError((e as Error).message);
      throw e;
    } finally {
      setPending((n) => n - 1);
    }
  }, []);

  const refresh = useCallback(async () => {
    const data = await track(api<Workspace>('/api/workspace'));
    setWs(data);
    return data;
  }, [track]);

  // Conexão + atualização ao voltar para a aba (sincronização entre dispositivos
  // até o tempo real ser adicionado na Fase 8).
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => { setOnline(true); refresh().catch(() => {}); };
    const off = () => setOnline(false);
    const vis = () => { if (document.visibilityState === 'visible' && navigator.onLine) refresh().catch(() => {}); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [refresh]);

  const sync: SyncState = !online ? 'offline' : pending > 0 ? 'saving' : lastError ? 'error' : 'idle';

  // ── Espaços ──────────────────────────────────────────────
  const createSpace = useCallback(async (input: SpaceInput) => {
    const s = await track(api<Space>('/api/spaces', { method: 'POST', body: input }));
    setWs((w) => ({ ...w, spaces: [...w.spaces, s] }));
    return s;
  }, [track]);

  const updateSpace = useCallback(async (id: string, input: Partial<SpaceInput>) => {
    const s = await track(api<Space>(`/api/spaces/${id}`, { method: 'PATCH', body: input }));
    setWs((w) => ({ ...w, spaces: w.spaces.map((x) => (x.id === id ? s : x)) }));
    return s;
  }, [track]);

  const deleteSpace = useCallback(async (id: string) => {
    await track(api(`/api/spaces/${id}`, { method: 'DELETE' }));
    setWs((w) => ({
      ...w,
      spaces: w.spaces.filter((x) => x.id !== id),
      categories: w.categories.filter((x) => x.space_id !== id),
      channels: w.channels.filter((x) => x.space_id !== id),
    }));
  }, [track]);

  // ── Categorias ───────────────────────────────────────────
  const createCategory = useCallback(async (space_id: string, input: CategoryInput) => {
    const c = await track(api<Category>('/api/categories', { method: 'POST', body: { space_id, ...input } }));
    setWs((w) => ({ ...w, categories: [...w.categories, c] }));
    return c;
  }, [track]);

  const updateCategory = useCallback(async (id: string, input: Partial<CategoryInput>) => {
    const c = await track(api<Category>(`/api/categories/${id}`, { method: 'PATCH', body: input }));
    setWs((w) => ({ ...w, categories: w.categories.map((x) => (x.id === id ? c : x)) }));
    return c;
  }, [track]);

  const toggleCategory = useCallback(async (id: string) => {
    const prev = wsRef.current.categories.find((c) => c.id === id);
    if (!prev) return;
    const collapsed = !prev.collapsed;
    setWs((w) => ({ ...w, categories: w.categories.map((x) => (x.id === id ? { ...x, collapsed } : x)) }));
    try {
      await track(api(`/api/categories/${id}`, { method: 'PATCH', body: { collapsed } }));
    } catch (e) {
      setWs((w) => ({ ...w, categories: w.categories.map((x) => (x.id === id ? { ...x, collapsed: prev.collapsed } : x)) }));
      throw e;
    }
  }, [track]);

  const deleteCategory = useCallback(async (id: string, channels: 'keep' | 'delete') => {
    await track(api(`/api/categories/${id}?channels=${channels}`, { method: 'DELETE' }));
    // recarrega para obter as novas posições dos canais preservados
    await refresh();
  }, [track, refresh]);

  // ── Canais ───────────────────────────────────────────────
  const createChannel = useCallback(async (space_id: string, input: ChannelInput) => {
    const c = await track(api<Channel>('/api/channels', { method: 'POST', body: { space_id, ...input } }));
    setWs((w) => ({ ...w, channels: [...w.channels, c] }));
    return c;
  }, [track]);

  const updateChannel = useCallback(async (id: string, input: Partial<ChannelInput>) => {
    const c = await track(api<Channel>(`/api/channels/${id}`, { method: 'PATCH', body: input }));
    setWs((w) => ({ ...w, channels: w.channels.map((x) => (x.id === id ? c : x)) }));
    return c;
  }, [track]);

  const deleteChannel = useCallback(async (id: string) => {
    await track(api(`/api/channels/${id}`, { method: 'DELETE' }));
    setWs((w) => ({ ...w, channels: w.channels.filter((x) => x.id !== id) }));
  }, [track]);

  // ── Reordenação (otimista) ───────────────────────────────
  const reorder = useCallback(async (
    table: 'spaces' | 'categories' | 'channels',
    ids: string[],
  ) => {
    const before = wsRef.current;
    const pos = new Map(ids.map((id, i) => [id, i]));
    const apply = <T extends { id: string; position: number }>(list: T[]) =>
      list.map((x) => (pos.has(x.id) ? { ...x, position: pos.get(x.id)! } : x));
    setWs((w) => ({ ...w, [table]: apply(w[table] as never[]) }));
    try {
      await track(api('/api/reorder', { method: 'POST', body: { table, ids } }));
    } catch (e) {
      setWs(before);
      throw e;
    }
  }, [track]);

  return {
    ws,
    sync,
    lastError,
    refresh,
    spaces: [...ws.spaces].sort(byPos),
    categoriesOf: (spaceId: string) => ws.categories.filter((c) => c.space_id === spaceId).sort(byPos),
    channelsOf: (spaceId: string, categoryId: string | null) =>
      ws.channels.filter((c) => c.space_id === spaceId && c.category_id === categoryId).sort(byPos),
    createSpace, updateSpace, deleteSpace,
    createCategory, updateCategory, toggleCategory, deleteCategory,
    createChannel, updateChannel, deleteChannel,
    reorder,
  };
}

export type WorkspaceApi = ReturnType<typeof useWorkspace>;

/** Move o item `id` uma posição para cima (-1) ou para baixo (+1) e retorna a nova ordem. */
export function shift(ids: string[], id: string, dir: -1 | 1): string[] | null {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
