/**
 * Invoice Analytics API Route
 * GET /api/v1/invoices/analytics - Get invoice analytics
 */

import { ApiInvoiceController } from 'server/src/lib/api/controllers/ApiInvoiceController';

const controller = new ApiInvoiceController();

export async function GET(request: Request) {
  return controller.getAnalytics()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';