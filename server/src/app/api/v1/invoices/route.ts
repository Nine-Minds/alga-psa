/**
 * Invoices API Route
 * GET /api/v1/invoices - List invoices
 * POST /api/v1/invoices - Create invoice
 */

import { ApiInvoiceController } from '@product/api/controllers/ApiInvoiceController';

export async function GET(request: Request) {
  const controller = new ApiInvoiceController();
  return controller.list()(request as any);
}

export async function POST(request: Request) {
  const controller = new ApiInvoiceController();
  return controller.create()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';