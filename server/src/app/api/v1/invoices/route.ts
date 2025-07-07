/**
 * Invoices API Route
 * GET /api/v1/invoices - List invoices
 * POST /api/v1/invoices - Create invoice
 */

import { ApiInvoiceControllerV2 } from 'server/src/lib/api/controllers/ApiInvoiceControllerV2';

export async function GET(request: Request) {
  const controller = new ApiInvoiceControllerV2();
  return controller.list()(request as any);
}

export async function POST(request: Request) {
  const controller = new ApiInvoiceControllerV2();
  return controller.create()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';