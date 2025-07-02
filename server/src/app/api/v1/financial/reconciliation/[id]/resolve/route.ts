/**
 * Financial Reconciliation Resolve API Route
 * POST /api/v1/financial/reconciliation/[id]/resolve - Resolve discrepancy
 */

import { FinancialController } from 'server/src/lib/api/controllers/FinancialController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const financialController = new FinancialController();
    const req = request as any;
    req.params = params;
    return await financialController.resolveReconciliationReport()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';