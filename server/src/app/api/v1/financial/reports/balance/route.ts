/**
 * Financial Account Balance Report API Route
 * GET /api/v1/financial/reports/balance - Get account balance report
 */

import { ApiFinancialControllerV2 } from 'server/src/lib/api/controllers/ApiFinancialControllerV2';

export async function GET(request: Request) {
  const controller = new ApiFinancialControllerV2();
  return await controller.getAccountBalanceReport()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';