/**
 * QuickBooks OAuth Disconnect API Route
 * DELETE /api/v1/integrations/quickbooks/oauth/disconnect - Disconnect QuickBooks integration
 */

import { ApiQuickBooksController } from 'server/src/lib/api/controllers/ApiQuickBooksController';
import { QuickBooksService } from 'server/src/lib/api/services/QuickBooksService';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

let controller: ApiQuickBooksController | null = null;

function getController() {
  if (!controller) {
    const quickBooksService = new QuickBooksService(null as any, null as any, null as any);
    controller = new ApiQuickBooksController();
  }
  return controller;
}

export async function DELETE(request: Request) {
  try {
    return await getController().disconnectOAuth()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';