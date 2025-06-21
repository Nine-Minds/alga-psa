/**
 * Invoice Bulk Operations API Route
 * POST /api/v1/invoices/bulk - Bulk invoice operations
 */

import { InvoiceController } from 'server/src/lib/api/controllers/InvoiceController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new InvoiceController();

export async function POST(request: Request) {
  try {
    return await controller.bulkUpdateStatus()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';