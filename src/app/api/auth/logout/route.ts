import { type NextRequest } from 'next/server';
import { destroySession } from '@/lib/server/session';
import { fail, handleError, json } from '@/lib/server/api';

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get('origin');
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    if (!origin || !host || new URL(origin).host !== host) return fail(403, 'Origem não permitida.');
    await destroySession();
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
