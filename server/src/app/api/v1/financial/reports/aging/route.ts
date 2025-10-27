/**
 * Financial Aging Report API Route
 * GET /api/v1/financial/reports/aging - Get aging report
 */

import { ApiFinancialController } from '@product/api/controllers/ApiFinancialController';

export async function GET(request: Request) {
  const controller = new ApiFinancialController();
  return await controller.getAgingReport()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';