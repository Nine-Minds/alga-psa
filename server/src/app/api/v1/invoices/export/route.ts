/**
 * Invoice Export API Route
 * GET /api/v1/invoices/export - Export invoices
 */

import { ApiInvoiceController } from '@product/api/controllers/ApiInvoiceController';

const controller = new ApiInvoiceController();

export async function GET(request: Request) {
  return controller.export()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';