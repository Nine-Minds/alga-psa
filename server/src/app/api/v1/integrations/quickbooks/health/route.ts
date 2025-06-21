/**
 * QuickBooks Health API Route
 * GET /api/v1/integrations/quickbooks/health - Get integration health status
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
    return await getController().getHealth()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';