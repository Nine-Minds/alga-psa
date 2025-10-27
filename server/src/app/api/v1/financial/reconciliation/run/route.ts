/**
 * Financial Reconciliation Run API Route
 * POST /api/v1/financial/reconciliation/run - Run reconciliation
 */

import { ApiFinancialController } from '@product/api/controllers/ApiFinancialController';

export async function POST(request: Request) {
  const financialController = new ApiFinancialController();
  return await financialController.runReconciliation()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';