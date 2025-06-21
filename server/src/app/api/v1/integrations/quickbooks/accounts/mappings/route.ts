/**
 * QuickBooks Account Mappings API Route
 * GET /api/v1/integrations/quickbooks/accounts/mappings - Get account mappings
 * PUT /api/v1/integrations/quickbooks/accounts/mappings - Configure account mappings
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
    return await getController().getAccountMappings()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    return await getController().configureAccountMappings()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';