/**
 * QuickBooks Data Mapping by ID API Route
 * GET /api/v1/integrations/quickbooks/mappings/[mapping_id] - Get data mapping by ID
 * PUT /api/v1/integrations/quickbooks/mappings/[mapping_id] - Update data mapping
 * DELETE /api/v1/integrations/quickbooks/mappings/[mapping_id] - Delete data mapping
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

export async function GET(request: Request, { params }: { params: { mapping_id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await getController().getDataMappingById()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: { mapping_id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await getController().updateDataMapping()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: { mapping_id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await getController().deleteDataMapping()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';