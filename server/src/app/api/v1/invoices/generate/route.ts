/**
 * Invoice Generation API Route
 * POST /api/v1/invoices/generate - Generate recurring invoice from selector input
 */

import { ApiInvoiceController } from 'server/src/lib/api/controllers/ApiInvoiceController';

const controller = new ApiInvoiceController();

export async function POST(request: Request) {
  return controller.generateRecurringInvoice()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
