/**
 * QuickBooks Data Mapping by ID API Route
 * GET /api/v1/integrations/quickbooks/mappings/[mapping_id] - Get data mapping by ID
 * PUT /api/v1/integrations/quickbooks/mappings/[mapping_id] - Update data mapping
 * DELETE /api/v1/integrations/quickbooks/mappings/[mapping_id] - Delete data mapping
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

export async function GET(request: Request, { params }: { params: Promise<{ mapping_id: string }> }) {
  try {
    const req = request as any;
    req.params = params;
    return await getController().getDataMappingById()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ mapping_id: string }> }) {
  try {
    const req = request as any;
    req.params = params;
    return await getController().updateDataMapping()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ mapping_id: string }> }) {
  try {
    const req = request as any;
    req.params = params;
    return await getController().deleteDataMapping()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';