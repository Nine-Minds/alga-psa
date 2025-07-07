/**
 * Invoice Export API Route
 * GET /api/v1/invoices/export - Export invoices
 */

import { ApiInvoiceControllerV2 } from 'server/src/lib/api/controllers/ApiInvoiceControllerV2';

const controller = new ApiInvoiceControllerV2();

export async function GET(request: Request) {
  return controller.export()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';