/**
 * Invoice Transactions API Route
 * GET /api/v1/invoices/[id]/transactions - List invoice transactions
 */

import { InvoiceController } from 'server/src/lib/api/controllers/InvoiceController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new InvoiceController();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.listTransactions()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';