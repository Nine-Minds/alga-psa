/**
 * Financial Reconciliation Run API Route
 * POST /api/v1/financial/reconciliation/run - Run reconciliation
 */

import { ApiFinancialControllerV2 } from 'server/src/lib/api/controllers/ApiFinancialControllerV2';

export async function POST(request: Request) {
  const financialController = new ApiFinancialControllerV2();
  return await financialController.runReconciliation()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';