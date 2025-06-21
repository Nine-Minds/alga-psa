/**
 * QuickBooks Sync Status by ID API Route
 * GET /api/v1/integrations/quickbooks/sync/status/[sync_id] - Get specific sync status
 */

import { QuickBooksController } from 'server/src/lib/api/controllers/QuickBooksController';
import { QuickBooksService } from 'server/src/lib/api/services/QuickBooksService';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

let controller: QuickBooksController | null = null;

function getController() {
  if (!controller) {
    const quickBooksService = new QuickBooksService();
    controller = new QuickBooksController(quickBooksService);
  }
  return controller;
}

export async function GET(request: Request, { params }: { params: { sync_id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await getController().getSyncStatusById()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';