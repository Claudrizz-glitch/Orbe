import { json, protectedRoute } from '@/lib/server/api';
import { loadWorkspace } from '@/lib/server/workspace';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async () => json(await loadWorkspace()));
