/**
 * Financial Invoice Items API Route
 * POST /api/v1/financial/invoices/[id]/items - Add manual item to invoice
 */

import { FinancialController } from 'server/src/lib/api/controllers/FinancialController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new FinancialController();

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.addManualInvoiceItem()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';