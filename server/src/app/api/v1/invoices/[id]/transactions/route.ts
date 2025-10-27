/**
 * Invoice Transactions API Route
 * GET /api/v1/invoices/[id]/transactions - List invoice transactions
 */

import { ApiInvoiceController } from '@product/api/controllers/ApiInvoiceController';

const controller = new ApiInvoiceController();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.listTransactions()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';