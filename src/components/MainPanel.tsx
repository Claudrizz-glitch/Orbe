'use client';

import type { Category, Channel, Identity, Space } from '@/lib/types';
import { MessageList } from './MessageList';
import { IconDiscord, IconHash, IconMenu, IconOrbit, IconPlus, IconSidebar } from './ui/Icons';

interface Props {
  space: Space | null;
  category: Category | null;
  channel: Channel | null;
  hasSpaces: boolean;
  identities: Map<string, Identity>;
  onToggleSidebar: () => void;
  onOpenDrawer: () => void;
  onCreateSpace: () => void;
  onCreateChannel: () => void;
  onImport: () => void;
}

export function MainPanel(p: Props) {
  const { space, category, channel } = p;
  return (
    <main className="main">
      <header className="main__head">
        <button className="icon-btn only-mobile" onClick={p.onOpenDrawer} aria-label="Abrir navegação"><IconMenu /></button>
        <button className="icon-btn only-desktop" onClick={p.onToggleSidebar} aria-label="Mostrar/ocultar barras laterais" title="Mostrar/ocultar barras laterais (Ctrl+\)">
          <IconSidebar />
        </button>
        {channel ? (
          <div className="main__title">
            <span className="main__chan-icon" style={{ color: channel.color ?? undefined }}>{channel.icon ?? <IconHash size={17} />}</span>
            <h2>{channel.name}</h2>
            {(space || category) && <span className="main__crumb">{space?.name}{category ? ` / ${category.name}` : ''}</span>}
            {channel.topic && <span className="main__topic" title={channel.topic}>{channel.topic}</span>}
          </div>
        ) : (
          <div className="main__title"><h2>{space?.name ?? 'ORBE'}</h2></div>
        )}
      </header>

      {channel ? (
        <MessageList key={channel.id} channel={channel} identities={p.identities} />
      ) : (
        <div className="main__body">
          {!p.hasSpaces ? (
            <div className="empty">
              <div className="empty__orb"><IconOrbit size={34} /></div>
              <h3>Bem-vindo ao seu ORBE</h3>
              <p>Comece criando um espaço — uma grande área da sua vida, como Diário, Ideias ou Escrita — ou traga seus servidores do Discord.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button className="btn btn--primary" onClick={p.onCreateSpace}><IconPlus size={15} /> Criar espaço</button>
                <button className="btn" onClick={p.onImport}><IconDiscord size={15} /> Importar do Discord</button>
              </div>
            </div>
          ) : (
            <div className="empty">
              <h3>Nenhum canal selecionado</h3>
              <p>Escolha um canal na barra lateral ou crie um novo neste espaço.</p>
              {space && <button className="btn btn--primary" onClick={p.onCreateChannel}><IconPlus size={15} /> Novo canal</button>}
            </div>
          )}
        </div>
      )}

      {channel && (
        <div className="composer composer--disabled" aria-disabled="true">
          <div className="composer__box">
            <span>Escrever em #{channel.name}</span>
            <span className="tag-soon">Fase 2</span>
          </div>
        </div>
      )}
    </main>
  );
}
