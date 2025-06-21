/**
 * Financial Reconciliation Resolve API Route
 * POST /api/v1/financial/reconciliation/[id]/resolve - Resolve discrepancy
 */

import { FinancialController } from 'server/src/lib/api/controllers/FinancialController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new FinancialController();

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.resolveDiscrepancy()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';