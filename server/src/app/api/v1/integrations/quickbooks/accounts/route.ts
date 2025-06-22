/**
 * QuickBooks Accounts API Route
 * GET /api/v1/integrations/quickbooks/accounts - Get QuickBooks chart of accounts
 */

import { QuickBooksController } from 'server/src/lib/api/controllers/QuickBooksController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new QuickBooksController();

export async function GET(request: Request) {
  try {
    return await controller.getAccounts()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';