/**
 * Invoice Credit Application API Route
 * POST /api/v1/invoices/[id]/credit - Apply credit to invoice
 */

import { InvoiceController } from 'server/src/lib/api/controllers/InvoiceController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new InvoiceController();

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.applyCredit()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';