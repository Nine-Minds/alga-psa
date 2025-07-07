/**
 * Financial Reconciliation Resolve API Route
 * POST /api/v1/financial/reconciliation/[id]/resolve - Resolve discrepancy
 */

import { ApiFinancialControllerV2 } from 'server/src/lib/api/controllers/ApiFinancialControllerV2';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const financialController = new ApiFinancialControllerV2();
  const req = request as any;
  req.params = params;
  return await financialController.resolveReconciliationReport()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';