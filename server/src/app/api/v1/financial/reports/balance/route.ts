/**
 * Financial Account Balance Report API Route
 * GET /api/v1/financial/reports/balance - Get account balance report
 */

import { ApiFinancialController } from '@product/api/controllers/ApiFinancialController';

export async function GET(request: Request) {
  const controller = new ApiFinancialController();
  return await controller.getAccountBalanceReport()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';