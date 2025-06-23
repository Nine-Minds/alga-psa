/**
 * QuickBooks Retry Sync API Route
 * POST /api/v1/integrations/quickbooks/sync/[sync_id]/retry - Retry sync operation
 */

import { QuickBooksController } from 'server/src/lib/api/controllers/QuickBooksController';
import { QuickBooksService } from 'server/src/lib/api/services/QuickBooksService';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

let controller: QuickBooksController | null = null;

function getController() {
  if (!controller) {
    const quickBooksService = new QuickBooksService(null as any, null as any, null as any);
    controller = new QuickBooksController();
  }
  return controller;
}

export async function POST(request: Request, { params }: { params: { sync_id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await getController().retrySync()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';