/**
 * QuickBooks Connection Test API Route
 * POST /api/v1/integrations/quickbooks/connection/test - Test connection with diagnostics
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

export async function POST(request: Request) {
  try {
    return await getController().testConnection()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';