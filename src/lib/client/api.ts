'use client';

export class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * fetch para os endpoints do ORBE. Converte respostas de erro em mensagens
 * legíveis e redireciona ao login quando a sessão expira.
 */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new RequestError(0, 'Sem conexão com o servidor. Verifique sua internet e tente de novo.');
  }
  if (res.status === 401) {
    window.location.href = '/login';
    throw new RequestError(401, 'Sessão expirada.');
  }
  let data: unknown = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `Erro ${res.status}`;
    throw new RequestError(res.status, msg);
  }
  return data as T;
}
