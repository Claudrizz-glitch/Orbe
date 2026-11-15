import { redirect } from 'next/navigation';
import { hasValidSession } from '@/lib/server/session';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Entrar · ORBE' };

export default async function LoginPage() {
  let loggedIn = false;
  try { loggedIn = await hasValidSession(); } catch { /* banco indisponível → mostra o formulário */ }
  if (loggedIn) redirect('/');
  return (
    <div className="login">
      <div className="login__glow" aria-hidden="true" />
      <LoginForm />
    </div>
  );
}
