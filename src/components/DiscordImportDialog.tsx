'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import type { DiscordStatus, ImportJob } from '@/lib/types';
import { Modal } from './ui/Modal';
import { IconAlert, IconDiscord, IconExternal, IconRefresh } from './ui/Icons';

interface Props {
  job: ImportJob | null;
  paused: boolean;
  onStart: (job: ImportJob) => void;
  onPause: () => void;
  onResume: (job: ImportJob) => void;
  onCancel: () => void;
  onOpenSpace: (spaceId: string) => void;
  onClose: () => void;
}

function bytes(n: number) {
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function DiscordImportDialog({ job, paused, onStart, onPause, onResume, onCancel, onOpenSpace, onClose }: Props) {
  const [status, setStatus] = useState<DiscordStatus | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [ownerIsMe, setOwnerIsMe] = useState(true);
  const [withFiles, setWithFiles] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setLoadErr(null);
    try {
      const s = await api<DiscordStatus>('/api/discord/status');
      setStatus(s);
      // Uma importação ficou em andamento (ORBE foi fechado): retoma automaticamente
      const running = s.jobs.find((j) => j.status === 'running');
      if (running && !job) onStart(running);
    }
    catch (e) { setLoadErr((e as Error).message); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh(); }, []);

  async function start() {
    if (!selected) return;
    setBusy(true);
    setErr(null);
    try {
      onStart(await api<ImportJob>('/api/discord/import', { method: 'POST', body: { guild_id: selected, owner_is_me: ownerIsMe, attachments: withFiles } }));
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  const active = job && (job.status === 'running' || job.status === 'error' || (job.status === 'done' && job.progress.total > 0) || job.status === 'cancelled') ? job : null;

  return (
    <Modal title="Importar do Discord" onClose={onClose} width={560}
      footer={active ? <JobFooter job={active} paused={paused} onPause={onPause} onResume={() => onResume(active)} onCancel={onCancel} onOpenSpace={onOpenSpace} onClose={onClose} onNew={() => { onCancel(); void refresh(); }} />
        : status?.configured && !status.error ? (
          <>
            <button className="btn" onClick={onClose}>Fechar</button>
            <button className="btn btn--primary" disabled={!selected || busy} onClick={start}>{busy ? 'Preparando…' : 'Importar servidor'}</button>
          </>
        ) : <button className="btn" onClick={onClose}>Fechar</button>}
    >
      {active ? <JobView job={active} paused={paused} /> : (
        <div className="imp">
          {!status && !loadErr && <p className="muted">Verificando a integração…</p>}
          {loadErr && <p className="form-error"><IconAlert size={14} /> {loadErr}</p>}

          {status && !status.configured && <SetupGuide onRetry={refresh} />}

          {status?.error && (
            <>
              <p className="form-error">{status.error}</p>
              <button className="btn btn--sm" onClick={refresh}><IconRefresh size={14} /> Verificar novamente</button>
            </>
          )}

          {status?.configured && !status.error && (
            <>
              <p className="imp__intro">
                Conectado como <strong>{status.bot?.name}</strong>. Cada servidor vira um espaço; categorias, canais, tópicos,
                mensagens, autores (como identidades) e anexos são copiados. Reimportar depois traz só o que é novo.
              </p>

              {!status.message_content && (
                <p className="imp__note" style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}>
                  A <strong>Message Content Intent</strong> está desativada: as mensagens viriam vazias. Ative em
                  Developer Portal → seu app → Bot → Privileged Gateway Intents, e clique em verificar novamente.
                </p>
              )}

              {status.guilds?.length ? (
                <div className="guilds" role="radiogroup" aria-label="Servidores">
                  {status.guilds.map((g) => (
                    <button key={g.id} role="radio" aria-checked={selected === g.id} className={`guild ${selected === g.id ? 'is-on' : ''}`} onClick={() => setSelected(g.id)}>
                      {g.icon_url ? <img src={g.icon_url} alt="" /> : <span className="guild__ph">{g.name.slice(0, 2).toUpperCase()}</span>}
                      <span className="guild__name">
                        <strong>{g.name}</strong>
                        <small>{g.space_id ? 'Já importado — importar de novo traz apenas o que é novo' : 'Ainda não importado'}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="imp__note">O bot ainda não está em nenhum servidor. Adicione-o pelo link abaixo e verifique novamente.</p>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a className="btn btn--sm" href={status.invite_url} target="_blank" rel="noreferrer"><IconExternal size={14} /> Adicionar bot a um servidor</a>
                <button className="btn btn--sm btn--ghost" onClick={refresh}><IconRefresh size={14} /> Verificar novamente</button>
              </div>
              <p className="muted small">
                O link pede só “Ver canais” e “Ler histórico”. Para canais privados, dê acesso ao cargo do bot nesses canais
                ou use o <a href={status.invite_admin_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>link com permissão de administrador</a> (o ORBE apenas lê; nunca escreve no Discord).
              </p>

              <label className="check">
                <input type="checkbox" checked={ownerIsMe} onChange={(e) => setOwnerIsMe(e.target.checked)} />
                <span>Sou o dono do servidor<small>Minhas mensagens aparecem com a identidade “Eu” do ORBE.</small></span>
              </label>
              <label className="check">
                <input type="checkbox" checked={withFiles} onChange={(e) => setWithFiles(e.target.checked)} />
                <span>Baixar anexos<small>Imagens e arquivos são copiados (os links do Discord expiram). Limite de 50 MB por arquivo.</small></span>
              </label>

              {status.storage === 'local' && (
                <p className="imp__note">Modo local: tudo é salvo na pasta <code>orbe-data/</code> deste computador — é o seu backup. Quando o Supabase for conectado, essa pasta poderá ser restaurada nele.</p>
              )}
              {err && <p className="form-error">{err}</p>}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function JobView({ job, paused }: { job: ImportJob; paused: boolean }) {
  const p = job.progress;
  const pct = p.phase === 'done' || job.status === 'done' ? 100 : p.phase === 'structure' ? 2 : Math.max(3, Math.round((p.channel / Math.max(1, p.total)) * 100));
  const s = job.stats;
  const label = job.status === 'done' ? 'Importação concluída'
    : job.status === 'error' ? 'Importação interrompida'
      : job.status === 'cancelled' ? 'Importação cancelada'
        : paused ? 'Pausada' : p.phase === 'structure' ? 'Lendo a estrutura do servidor…'
          : p.pending_files ? `Baixando anexos (${p.pending_files} na fila)…` : `Canal ${p.channel + 1} de ${p.total}: #${p.current ?? ''}`;
  return (
    <div className="imp">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <IconDiscord size={18} />
        <strong style={{ fontWeight: 500 }}>{job.name}</strong>
        <span className="muted small" style={{ marginLeft: 'auto' }}>{pct}%</span>
      </div>
      <div className="progress"><div style={{ width: `${pct}%` }} /></div>
      <p className="muted small" style={{ marginTop: -8 }}>{label}</p>
      {job.error && <p className="form-error">{job.error}</p>}
      <div className="stats">
        <div className="stat"><b>{s.messages.toLocaleString('pt-BR')}</b><span>mensagens</span></div>
        <div className="stat"><b>{s.channels}</b><span>canais novos</span></div>
        <div className="stat"><b>{s.identities}</b><span>identidades</span></div>
        <div className="stat"><b>{s.attachments}</b><span>anexos · {bytes(s.bytes)}</span></div>
        <div className="stat"><b>{s.categories}</b><span>categorias</span></div>
        <div className="stat"><b>{s.skipped_channels + s.failed_attachments}</b><span>avisos</span></div>
      </div>
      <div className="imp__log" aria-live="polite">
        {job.log.slice().reverse().map((l, i) => <div key={i} className={l.level === 'warn' ? 'is-warn' : ''}>{l.msg}</div>)}
      </div>
      {job.status === 'running' && <p className="muted small">Pode fechar esta janela: a importação continua enquanto o ORBE estiver aberto. Se fechar o ORBE, ela retoma de onde parou.</p>}
    </div>
  );
}

function JobFooter({ job, paused, onPause, onResume, onCancel, onOpenSpace, onClose, onNew }: {
  job: ImportJob; paused: boolean; onPause: () => void; onResume: () => void; onCancel: () => void;
  onOpenSpace: (id: string) => void; onClose: () => void; onNew: () => void;
}) {
  if (job.status === 'running') {
    return <>
      <button className="btn btn--danger" onClick={onCancel}>Cancelar</button>
      {paused ? <button className="btn btn--primary" onClick={onResume}>Continuar</button> : <button className="btn" onClick={onPause}>Pausar</button>}
    </>;
  }
  return <>
    <button className="btn" onClick={onNew}>Importar outro</button>
    {(job.status === 'error' || job.status === 'cancelled') && <button className="btn" onClick={onResume}>Continuar de onde parou</button>}
    {job.space_id ? <button className="btn btn--primary" onClick={() => { onOpenSpace(job.space_id!); onClose(); }}>Abrir espaço</button> : <button className="btn btn--primary" onClick={onClose}>Fechar</button>}
  </>;
}

function SetupGuide({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      <p className="imp__intro">Para ler seus servidores, o ORBE usa um <strong>bot oficial</strong> — seguro e permitido pelos termos do Discord. Configuração única, ~3 minutos:</p>
      <ol className="imp__steps">
        <li><span>Abra o <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Discord Developer Portal</a> e clique em <strong>New Application</strong> (nome: ORBE).</span></li>
        <li><span>No menu <strong>Bot</strong>, ative <strong>Message Content Intent</strong> e salve.</span></li>
        <li><span>Ainda em <strong>Bot</strong>, clique em <strong>Reset Token</strong> e copie o token.</span></li>
        <li><span>Cole no arquivo <code>.env.local</code> do projeto: <code>DISCORD_BOT_TOKEN=seu_token</code> e reinicie o <code>npm run dev</code>.</span></li>
        <li><span>Volte aqui: o ORBE mostrará o link para adicionar o bot aos seus servidores.</span></li>
      </ol>
      <p className="imp__note">O token fica só no servidor do ORBE e nunca vai para o navegador. Nunca use o token da sua conta pessoal.</p>
      <div><button className="btn btn--sm" onClick={onRetry}><IconRefresh size={14} /> Já configurei — verificar</button></div>
    </>
  );
}
