/**
 * QuickBooks Invoice Export API Route
 * POST /api/v1/integrations/quickbooks/invoices/export - Export invoices to QuickBooks
 */

import { ApiQuickBooksController } from 'server/src/lib/api/controllers/ApiQuickBooksController';
import { QuickBooksService } from 'server/src/lib/api/services/QuickBooksService';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

let controller: ApiQuickBooksController | null = null;

function getController() {
  if (!controller) {
    const quickBooksService = new QuickBooksService(null as any, null as any, null as any);
    controller = new ApiQuickBooksController();
  }
  return controller;
}

export async function POST(request: Request) {
  try {
    return await getController().exportInvoices()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';