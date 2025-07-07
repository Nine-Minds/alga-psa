/**
 * QuickBooks Accounts API Route
 * GET /api/v1/integrations/quickbooks/accounts - Get QuickBooks chart of accounts
 */

import { ApiQuickBooksControllerV2 } from 'server/src/lib/api/controllers/ApiQuickBooksControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ApiQuickBooksControllerV2();

export async function GET(request: Request) {
  try {
    return await controller.getAccounts()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';