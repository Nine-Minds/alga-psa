/**
 * QuickBooks Sync History API Route
 * GET /api/v1/integrations/quickbooks/sync/history - Get synchronization history
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

export async function GET(request: Request) {
  try {
    return await getController().getSyncHistory()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';