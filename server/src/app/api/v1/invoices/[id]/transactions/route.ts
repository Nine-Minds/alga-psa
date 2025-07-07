/**
 * Invoice Transactions API Route
 * GET /api/v1/invoices/[id]/transactions - List invoice transactions
 */

import { ApiInvoiceControllerV2 } from 'server/src/lib/api/controllers/ApiInvoiceControllerV2';

const controller = new ApiInvoiceControllerV2();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.listTransactions()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';