import { redirect } from 'next/navigation';
import { hasValidSession } from '@/lib/server/session';
import { loadWorkspace } from '@/lib/server/workspace';
import { OrbeApp } from '@/components/OrbeApp';
import { ToastProvider } from '@/components/ui/Toasts';
import { ConfirmProvider } from '@/components/ui/ConfirmDialog';
import { ContextMenuProvider } from '@/components/ui/ContextMenu';

export const dynamic = 'force-dynamic';

export default async function Home() {
  // Validação real da sessão, no servidor, antes de carregar qualquer dado
  if (!(await hasValidSession())) redirect('/login');
  const workspace = await loadWorkspace();

  return (
    <ToastProvider>
      <ConfirmProvider>
        <ContextMenuProvider>
          <OrbeApp initial={workspace} />
        </ContextMenuProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
