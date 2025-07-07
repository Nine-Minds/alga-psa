/**
 * QuickBooks Full Sync API Route
 * POST /api/v1/integrations/quickbooks/sync/full - Execute comprehensive full synchronization
 */

import { ApiQuickBooksControllerV2 } from 'server/src/lib/api/controllers/ApiQuickBooksControllerV2';
import { QuickBooksService } from 'server/src/lib/api/services/QuickBooksService';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

let controller: ApiQuickBooksControllerV2 | null = null;

function getController() {
  if (!controller) {
    const quickBooksService = new QuickBooksService(null as any, null as any, null as any);
    controller = new ApiQuickBooksControllerV2();
  }
  return controller;
}

export async function POST(request: Request) {
  try {
    return await getController().fullSync()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';