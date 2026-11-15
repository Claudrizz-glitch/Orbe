import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/server/env';
import { verifyPassword } from '@/lib/server/password';
import { checkLoginAllowed, recordAttempt } from '@/lib/server/rateLimit';
import { createSession, cookieOptions, hashIp, SESSION_COOKIE } from '@/lib/server/session';
import { fail, getClientIp, handleError } from '@/lib/server/api';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get('origin');
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    if (!origin || !host || new URL(origin).host !== host) return fail(403, 'Origem não permitida.');

    let password = '';
    try {
      const body = await req.json();
      password = typeof body?.password === 'string' ? body.password : '';
    } catch { /* corpo inválido → senha vazia */ }
    if (!password || password.length > 1024) return fail(400, 'Informe a senha.');

    const ipHash = hashIp(getClientIp(req));
    const gate = await checkLoginAllowed(ipHash);
    if (!gate.allowed) {
      const minutes = Math.ceil(gate.retryAfterSec / 60);
      return NextResponse.json(
        { error: `Muitas tentativas. Tente novamente em ${minutes} min.` },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } },
      );
    }

    const ok = await verifyPassword(password, env.passwordHash);
    await recordAttempt(ipHash, ok);
    if (!ok) {
      await sleep(400 + Math.random() * 300);
      return fail(401, 'Senha incorreta.');
    }

    const { token, expires } = await createSession(req.headers.get('user-agent'));
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(expires));
    return res;
  } catch (e) {
    return handleError(e);
  }
}
