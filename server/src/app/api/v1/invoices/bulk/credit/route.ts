/**
 * Invoice Bulk Credit Application API Route
 * POST /api/v1/invoices/bulk/credit - Bulk apply credit to invoices
 */

import { ApiInvoiceController } from 'server/src/lib/api/controllers/ApiInvoiceController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const controller = new ApiInvoiceController();
    return await controller.bulkApplyCredit()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';