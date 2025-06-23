/**
 * Financial Invoice Finalize API Route
 * POST /api/v1/financial/invoices/[id]/finalize - Finalize invoice
 */

import { FinancialController } from 'server/src/lib/api/controllers/FinancialController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const controller = new FinancialController();
    const req = request as any;
    req.params = params;
    return await controller.update()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';