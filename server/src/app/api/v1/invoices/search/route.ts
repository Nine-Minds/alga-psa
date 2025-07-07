/**
 * Invoice Search API Route
 * GET /api/v1/invoices/search - Advanced invoice search
 */

import { ApiInvoiceControllerV2 } from 'server/src/lib/api/controllers/ApiInvoiceControllerV2';

const controller = new ApiInvoiceControllerV2();

export async function GET(request: Request) {
  return controller.search()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';