/**
 * Invoice Search API Route
 * GET /api/v1/invoices/search - Advanced invoice search
 */

import { InvoiceController } from 'server/src/lib/api/controllers/InvoiceController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new InvoiceController();

export async function GET(request: Request) {
  try {
    return await controller.search()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';