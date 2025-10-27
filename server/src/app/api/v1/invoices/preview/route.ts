/**
 * Invoice Preview API Route
 * POST /api/v1/invoices/preview - Preview invoice before generation
 */

import { ApiInvoiceController } from '@product/api/controllers/ApiInvoiceController';

const controller = new ApiInvoiceController();

export async function POST(request: Request) {
  return controller.previewInvoice()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';