/**
 * Invoice Bulk Delete API Route
 * POST /api/v1/invoices/bulk/delete - Bulk delete invoices
 */

import { InvoiceController } from 'server/src/lib/api/controllers/InvoiceController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new InvoiceController();

export async function POST(request: Request) {
  try {
    return await controller.bulkDelete()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';