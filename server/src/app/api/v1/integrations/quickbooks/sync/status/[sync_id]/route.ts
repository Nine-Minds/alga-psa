/**
 * QuickBooks Sync Status by ID API Route
 * GET /api/v1/integrations/quickbooks/sync/status/[sync_id] - Get specific sync status
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

export async function GET(request: Request, { params }: { params: Promise<{ sync_id: string }> }) {
  try {
    const req = request as any;
    req.params = params;
    return await getController().getSyncStatusById()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';