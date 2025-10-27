/**
 * Invoice Search API Route
 * GET /api/v1/invoices/search - Advanced invoice search
 */

import { ApiInvoiceController } from '@product/api/controllers/ApiInvoiceController';

const controller = new ApiInvoiceController();

export async function GET(request: Request) {
  return controller.search()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';