/**
 * Financial Reconciliation Report API Route
 * GET /api/v1/financial/reconciliation/[id] - Get reconciliation report
 */

import { ApiFinancialController } from 'server/src/lib/api/controllers/ApiFinancialController';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const financialController = new ApiFinancialController();
  const req = request as any;
  req.params = params;
  return await financialController.getReconciliationReportById()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
