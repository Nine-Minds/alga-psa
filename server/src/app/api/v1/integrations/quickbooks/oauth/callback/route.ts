/**
 * QuickBooks OAuth Callback API Route
 * POST /api/v1/integrations/quickbooks/oauth/callback - Handle OAuth callback from QuickBooks
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

export async function POST(request: Request) {
  try {
    return await getController().handleOAuthCallback()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';