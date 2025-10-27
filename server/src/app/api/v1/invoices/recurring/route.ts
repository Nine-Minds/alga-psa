/**
 * Recurring Invoice Templates API Route
 * GET /api/v1/invoices/recurring - List recurring invoice templates
 * POST /api/v1/invoices/recurring - Create recurring invoice template
 */

import { ApiInvoiceController } from '@product/api/controllers/ApiInvoiceController';

const controller = new ApiInvoiceController();

export async function GET(request: Request) {
  return controller.listRecurringTemplates()(request as any);
}

export async function POST(request: Request) {
  return controller.createRecurringTemplate()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';