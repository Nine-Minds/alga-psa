/**
 * Manual Invoice API Route
 * POST /api/v1/invoices/manual - Create manual invoice
 */

import { ApiInvoiceController } from '@product/api/controllers/ApiInvoiceController';

const controller = new ApiInvoiceController();

export async function POST(request: Request) {
  return controller.createManualInvoice()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';