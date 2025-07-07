/**
 * Financial Aging Report API Route
 * GET /api/v1/financial/reports/aging - Get aging report
 */

import { ApiFinancialControllerV2 } from 'server/src/lib/api/controllers/ApiFinancialControllerV2';

export async function GET(request: Request) {
  const controller = new ApiFinancialControllerV2();
  return await controller.getAgingReport()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';