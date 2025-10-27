/**
 * QuickBooks Health Config API Route
 * GET /api/v1/integrations/quickbooks/health/config - Get health monitoring configuration
 * PUT /api/v1/integrations/quickbooks/health/config - Update health monitoring configuration
 */

import { ApiQuickBooksController } from '@product/api/controllers/ApiQuickBooksController';
import { QuickBooksService } from '@product/api/services/QuickBooksService';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

let controller: ApiQuickBooksController | null = null;

function getController() {
  if (!controller) {
    const quickBooksService = new QuickBooksService(null as any, null as any, null as any);
    controller = new ApiQuickBooksController();
  }
  return controller;
}

export async function GET(request: Request) {
  try {
    return await getController().getHealthConfig()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    return await getController().updateHealthConfig()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';