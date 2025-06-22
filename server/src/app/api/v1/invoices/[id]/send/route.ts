/**
 * Invoice Send API Route
 * POST /api/v1/invoices/[id]/send - Send invoice to customer
 */

import { InvoiceController } from 'server/src/lib/api/controllers/InvoiceController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new InvoiceController();

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.send()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';