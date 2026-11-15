'use client';

import { useState, type FormEvent } from 'react';
import { IconOrbit } from '@/components/ui/Icons';

export function LoginForm() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = '/';
        return;
      }
      const data = await res.json().catch(() => null);
      setError(data?.error ?? 'Não foi possível entrar.');
    } catch {
      setError('Sem conexão com o servidor.');
    }
    setBusy(false);
    setPassword('');
  }

  return (
    <form className="login__card" onSubmit={submit}>
      <div className="login__logo"><IconOrbit size={34} /></div>
      <h1 className="login__title">ORBE</h1>
      <p className="login__sub">Seu universo pessoal</p>
      <label className="sr-only" htmlFor="pw">Senha</label>
      <input
        id="pw"
        className="input input--lg"
        type="password"
        autoComplete="current-password"
        placeholder="Senha"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
        disabled={busy}
      />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn--primary btn--lg" type="submit" disabled={busy || !password}>
        {busy ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
