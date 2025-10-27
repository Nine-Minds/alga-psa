/**
 * Invoice Bulk Operations API Route
 * POST /api/v1/invoices/bulk - Bulk invoice operations
 */

import { ApiInvoiceController } from '@product/api/controllers/ApiInvoiceController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const controller = new ApiInvoiceController();
    return await controller.bulkUpdateStatus()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';