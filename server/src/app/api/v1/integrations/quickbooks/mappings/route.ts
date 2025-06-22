/**
 * QuickBooks Data Mappings API Route
 * GET /api/v1/integrations/quickbooks/mappings - Get data mapping configurations
 * POST /api/v1/integrations/quickbooks/mappings - Create new data mapping
 */

import { QuickBooksController } from 'server/src/lib/api/controllers/QuickBooksController';
import { QuickBooksService } from 'server/src/lib/api/services/QuickBooksService';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

let controller: QuickBooksController | null = null;

function getController() {
  if (!controller) {
    const quickBooksService = new QuickBooksService(null as any, null as any, null as any);
    controller = new QuickBooksController();
  }
  return controller;
}

export async function GET(request: Request) {
  try {
    return await getController().getDataMappings()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await getController().createDataMapping()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';