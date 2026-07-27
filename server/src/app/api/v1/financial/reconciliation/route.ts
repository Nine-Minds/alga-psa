/**
 * Financial Reconciliation API Route
 * GET /api/v1/financial/reconciliation - List reconciliation reports
 */

import { ApiFinancialController } from 'server/src/lib/api/controllers/ApiFinancialController';

export async function GET(request: Request) {
  const financialController = new ApiFinancialController();
  return await financialController.listReconciliationReports()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
