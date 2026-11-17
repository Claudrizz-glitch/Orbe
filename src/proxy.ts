import { NextResponse, type NextRequest } from 'next/server';

/**
 * Verificação OTIMISTA: só checa a presença do cookie para redirecionar
 * rapidamente ao login. A validação real da sessão acontece no servidor,
 * em cada página protegida e em cada endpoint (protectedRoute).
 */
const PUBLIC_PATHS = ['/login', '/api/auth/login'];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
  if (!req.cookies.has('orbe_session')) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)'],
};
