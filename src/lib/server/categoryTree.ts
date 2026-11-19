import 'server-only';
import { ApiError } from './api';
import { store } from './store';
import * as v from './validate';

export const MAX_DEPTH = 6;

/**
 * Valida a categoria-mãe de uma categoria (subcategorias, como pastas):
 * mesma do espaço, sem ciclos e com profundidade limitada.
 * Retorna o id validado (ou null = nível principal).
 */
export async function validParent(raw: unknown, spaceId: string, selfId?: string): Promise<string | null> {
  if (raw === null || raw === '') return null;
  const parentId = v.uuid(raw, 'Categoria-mãe');
  if (parentId === selfId) throw new ApiError(400, 'Uma categoria não pode ficar dentro dela mesma.');
  const all = await store().select<{ id: string; parent_id: string | null }>('categories', { cols: 'id, parent_id', eq: { space_id: spaceId } });
  const byId = new Map(all.map((c) => [c.id, c.parent_id]));
  if (!byId.has(parentId)) throw new ApiError(404, 'A categoria escolhida não está neste espaço.');

  // Sobe a partir da mãe: não pode passar pela própria categoria (ciclo)
  let depth = 1;
  for (let cur: string | null | undefined = parentId; cur; cur = byId.get(cur)) {
    if (cur === selfId) throw new ApiError(400, 'Não dá para colocar uma categoria dentro de uma subcategoria dela.');
    if (++depth > MAX_DEPTH + 1) break;
  }
  // Altura da própria árvore (subcategorias) somada à nova profundidade
  const childrenOf = (id: string) => all.filter((c) => c.parent_id === id).map((c) => c.id);
  const height = (id: string): number => 1 + Math.max(0, ...childrenOf(id).map(height));
  const own = selfId ? height(selfId) : 1;
  let parentDepth = 0;
  for (let cur: string | null | undefined = parentId; cur && parentDepth <= MAX_DEPTH; cur = byId.get(cur)) parentDepth++;
  if (parentDepth + own > MAX_DEPTH) throw new ApiError(400, `No máximo ${MAX_DEPTH} níveis de categorias, uma dentro da outra.`);
  return parentId;
}
