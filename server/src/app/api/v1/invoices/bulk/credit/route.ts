/**
 * Invoice Bulk Credit Application API Route
 * POST /api/v1/invoices/bulk/credit - Bulk apply credit to invoices
 */

import { ApiInvoiceControllerV2 } from 'server/src/lib/api/controllers/ApiInvoiceControllerV2';

export async function POST(request: Request) {
  try {
    const controller = new ApiInvoiceControllerV2();
    return await controller.bulkApplyCredit()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';