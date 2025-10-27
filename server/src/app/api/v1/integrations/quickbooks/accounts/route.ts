/**
 * QuickBooks Accounts API Route
 * GET /api/v1/integrations/quickbooks/accounts - Get QuickBooks chart of accounts
 */

import { ApiQuickBooksController } from '@product/api/controllers/ApiQuickBooksController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

const controller = new ApiQuickBooksController();

export async function GET(request: Request) {
  try {
    return await controller.getAccounts()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';