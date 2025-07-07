/**
 * Manual Invoice API Route
 * POST /api/v1/invoices/manual - Create manual invoice
 */

import { ApiInvoiceControllerV2 } from 'server/src/lib/api/controllers/ApiInvoiceControllerV2';

const controller = new ApiInvoiceControllerV2();

export async function POST(request: Request) {
  return controller.createManualInvoice()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';