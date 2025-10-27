/**
 * QuickBooks Account Mappings API Route
 * GET /api/v1/integrations/quickbooks/accounts/mappings - Get account mappings
 * PUT /api/v1/integrations/quickbooks/accounts/mappings - Configure account mappings
 */

import { ApiQuickBooksController } from '@product/api/controllers/ApiQuickBooksController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

const controller = new ApiQuickBooksController();

export async function GET(request: Request) {
  try {
    return await controller.getAccountMappings()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    return await controller.configureAccountMappings()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';