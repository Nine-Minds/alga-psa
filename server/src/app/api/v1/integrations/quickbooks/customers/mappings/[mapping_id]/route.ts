/**
 * QuickBooks Customer Mapping by ID API Route
 * DELETE /api/v1/integrations/quickbooks/customers/mappings/[mapping_id] - Delete customer mapping
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

export async function DELETE(request: Request, { params }: { params: Promise<{ mapping_id: string }> }) {
  try {
    const req = request as any;
    req.params = params;
    return await getController().deleteCustomerMapping()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';