import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { hasValidSession } from './session';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/** Bloqueia requisições de escrita vindas de outra origem (CSRF). */
function checkOrigin(req: NextRequest) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin || !host) throw new ApiError(403, 'Origem ausente.');
  if (new URL(origin).host !== host) throw new ApiError(403, 'Origem não permitida.');
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/**
 * Envolve um route handler: valida origem e sessão NO SERVIDOR antes de
 * qualquer acesso a dados, e converte erros em respostas JSON.
 */
export function protectedRoute<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      checkOrigin(req);
      if (!(await hasValidSession())) return fail(401, 'Sessão inválida ou expirada.');
      return await handler(req, ctx);
    } catch (e) {
      return handleError(e);
    }
  };
}

export function handleError(e: unknown) {
  if (e instanceof ApiError) return fail(e.status, e.message);
  // Erros do PostgREST/Postgres
  const pg = e as { code?: string; message?: string };
  if (pg?.code === '23503') return fail(409, 'Referência inválida (item relacionado não existe ou pertence a outro espaço).');
  if (pg?.code === '23514' || pg?.code === '22P02') return fail(400, 'Dados inválidos.');
  console.error('[ORBE API]', e);
  return fail(500, 'Erro interno no servidor.');
}

export async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error();
    return b as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'Corpo da requisição inválido.');
  }
}

export function getClientIp(req: NextRequest) {
  return (
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}
