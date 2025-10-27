/**
 * Invoice Generation API Route
 * POST /api/v1/invoices/generate - Generate invoice from billing cycle
 */

import { ApiInvoiceController } from '@product/api/controllers/ApiInvoiceController';

const controller = new ApiInvoiceController();

export async function POST(request: Request) {
  return controller.generateFromBillingCycle()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';