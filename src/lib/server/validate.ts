import 'server-only';
import { ApiError } from './api';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function uuid(v: unknown, field = 'id'): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new ApiError(400, `${field} inválido.`);
  return v.toLowerCase();
}

export function name(v: unknown, field = 'Nome'): string {
  if (typeof v !== 'string') throw new ApiError(400, `${field} é obrigatório.`);
  const s = v.trim().replace(/\s+/g, ' ');
  if (s.length < 1) throw new ApiError(400, `${field} não pode ficar vazio.`);
  if (s.length > 100) throw new ApiError(400, `${field} pode ter no máximo 100 caracteres.`);
  return s;
}

/** null/'' limpa o valor; undefined = não informado. */
export function optText(v: unknown, max: number, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string') throw new ApiError(400, `${field} inválido.`);
  const s = v.trim();
  if (s.length > max) throw new ApiError(400, `${field} pode ter no máximo ${max} caracteres.`);
  return s || null;
}

export function optColor(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !COLOR_RE.test(v)) throw new ApiError(400, 'Cor inválida (use #RRGGBB).');
  return v.toLowerCase();
}

export function optIcon(v: unknown) {
  return optText(v, 32, 'Ícone');
}

export function optBool(v: unknown, field: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw new ApiError(400, `${field} inválido.`);
  return v;
}

export function optObject(v: unknown, field: string): Record<string, unknown> | undefined {
  if (v === undefined) return undefined;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ApiError(400, `${field} inválido.`);
  if (JSON.stringify(v).length > 20000) throw new ApiError(400, `${field} muito grande.`);
  return v as Record<string, unknown>;
}

/** Remove chaves undefined para montar o PATCH. */
export function defined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
