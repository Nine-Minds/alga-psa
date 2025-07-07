/**
 * Invoice Generation API Route
 * POST /api/v1/invoices/generate - Generate invoice from billing cycle
 */

import { ApiInvoiceControllerV2 } from 'server/src/lib/api/controllers/ApiInvoiceControllerV2';

const controller = new ApiInvoiceControllerV2();

export async function POST(request: Request) {
  return controller.generateFromBillingCycle()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';