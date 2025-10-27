/**
 * Invoice Credit Application API Route
 * POST /api/v1/invoices/[id]/credit - Apply credit to invoice
 */

import { ApiInvoiceController } from '@product/api/controllers/ApiInvoiceController';

const controller = new ApiInvoiceController();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.applyCredit()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';