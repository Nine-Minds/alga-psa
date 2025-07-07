/**
 * Recurring Invoice Templates API Route
 * GET /api/v1/invoices/recurring - List recurring invoice templates
 * POST /api/v1/invoices/recurring - Create recurring invoice template
 */

import { ApiInvoiceControllerV2 } from 'server/src/lib/api/controllers/ApiInvoiceControllerV2';

const controller = new ApiInvoiceControllerV2();

export async function GET(request: Request) {
  return controller.listRecurringTemplates()(request as any);
}

export async function POST(request: Request) {
  return controller.createRecurringTemplate()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';