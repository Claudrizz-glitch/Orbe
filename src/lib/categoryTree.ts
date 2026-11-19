import type { Category } from './types';

/** Ajudas para categorias aninhadas (subcategorias), usadas na interface. */

const byPos = (a: Category, b: Category) => a.position - b.position;

/** Categorias-raiz: sem mãe, ou com mãe que não está na lista. */
export function rootsOf(cats: Category[]): Category[] {
  const ids = new Set(cats.map((c) => c.id));
  return cats.filter((c) => !c.parent_id || !ids.has(c.parent_id)).sort(byPos);
}

export function childrenOf(cats: Category[], id: string): Category[] {
  return cats.filter((c) => c.parent_id === id).sort(byPos);
}

/** Irmãs (mesma mãe), na ordem de exibição. */
export function siblingsOf(cats: Category[], c: Category): Category[] {
  const ids = new Set(cats.map((x) => x.id));
  const parent = c.parent_id && ids.has(c.parent_id) ? c.parent_id : null;
  return parent ? childrenOf(cats, parent) : rootsOf(cats);
}

/** Todas as subcategorias (em qualquer nível) de uma categoria. */
export function descendantsOf(cats: Category[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (x: string) => { for (const k of childrenOf(cats, x)) if (!out.has(k.id)) { out.add(k.id); walk(k.id); } };
  walk(id);
  return out;
}

/** Lista em ordem de árvore, com a profundidade de cada uma. */
export function treeOrder(cats: Category[]): { cat: Category; depth: number }[] {
  const out: { cat: Category; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (c: Category, depth: number) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    out.push({ cat: c, depth });
    for (const k of childrenOf(cats, c.id)) walk(k, depth + 1);
  };
  for (const r of rootsOf(cats)) walk(r, 0);
  return out;
}

/** Caminho "Mãe › Filha" de uma categoria. */
export function pathOf(cats: Category[], id: string): string {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const names: string[] = [];
  for (let c = byId.get(id), n = 0; c && n < 10; c = c.parent_id ? byId.get(c.parent_id) : undefined, n++) names.unshift(c.name);
  return names.join(' › ');
}
