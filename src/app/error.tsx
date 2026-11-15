'use client';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="fullscreen-center">
      <div className="card card--narrow">
        <h1 className="card__title">Não foi possível carregar o ORBE</h1>
        <p className="muted">
          Pode ser uma falha temporária de conexão com o banco de dados. Seus dados não foram alterados.
        </p>
        {error.digest && <p className="muted small">Código: {error.digest}</p>}
        <button className="btn btn--primary" onClick={reset}>Tentar novamente</button>
      </div>
    </div>
  );
}
