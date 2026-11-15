'use client';

import type { Category, Channel, Space } from '@/lib/types';
import { IconHash, IconMenu, IconOrbit, IconPlus, IconSidebar } from './ui/Icons';

interface Props {
  space: Space | null;
  category: Category | null;
  channel: Channel | null;
  hasSpaces: boolean;
  onToggleSidebar: () => void;
  onOpenDrawer: () => void;
  onCreateSpace: () => void;
  onCreateChannel: () => void;
}

export function MainPanel({ space, category, channel, hasSpaces, onToggleSidebar, onOpenDrawer, onCreateSpace, onCreateChannel }: Props) {
  return (
    <main className="main">
      <header className="main__head">
        <button className="icon-btn only-mobile" onClick={onOpenDrawer} aria-label="Abrir navegação"><IconMenu /></button>
        <button className="icon-btn only-desktop" onClick={onToggleSidebar} aria-label="Mostrar/ocultar barras laterais" title="Mostrar/ocultar barras laterais (Ctrl+\)">
          <IconSidebar />
        </button>
        {channel ? (
          <div className="main__title">
            <span className="main__chan-icon" style={{ color: channel.color ?? undefined }}>{channel.icon ?? <IconHash size={18} />}</span>
            <h2>{channel.name}</h2>
            {(space || category) && (
              <span className="main__crumb">{space?.name}{category ? ` / ${category.name}` : ''}</span>
            )}
            {channel.topic && <span className="main__topic" title={channel.topic}>{channel.topic}</span>}
          </div>
        ) : (
          <div className="main__title"><h2>{space?.name ?? 'ORBE'}</h2></div>
        )}
      </header>

      <div className="main__body">
        {!hasSpaces ? (
          <div className="empty">
            <div className="empty__orb"><IconOrbit size={40} /></div>
            <h3>Bem-vindo ao seu ORBE</h3>
            <p>Comece criando um espaço — uma grande área da sua vida, como Diário, Ideias, Projetos ou Escrita.</p>
            <button className="btn btn--primary" onClick={onCreateSpace}><IconPlus size={16} /> Criar primeiro espaço</button>
          </div>
        ) : !channel ? (
          <div className="empty">
            <h3>Nenhum canal selecionado</h3>
            <p>Escolha um canal na barra lateral ou crie um novo neste espaço.</p>
            {space && <button className="btn btn--primary" onClick={onCreateChannel}><IconPlus size={16} /> Novo canal</button>}
          </div>
        ) : (
          <div className="empty">
            <div className="empty__chan" style={{ color: channel.color ?? undefined }}>{channel.icon ?? <IconHash size={34} />}</div>
            <h3>#{channel.name}</h3>
            <p>Este é o começo do canal.</p>
            <p className="soon-note">As mensagens, o editor e as identidades de autoria chegam na <strong>Fase 2</strong>.</p>
          </div>
        )}
      </div>

      {channel && (
        <div className="composer composer--disabled" aria-disabled="true">
          <div className="composer__box">
            <span>Escrever em #{channel.name}</span>
            <span className="tag-soon">Disponível na Fase 2</span>
          </div>
        </div>
      )}
    </main>
  );
}
