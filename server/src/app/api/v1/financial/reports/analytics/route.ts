/**
 * Financial Analytics Report API Route
 * GET /api/v1/financial/reports/analytics - Get financial analytics
 */

import { ApiFinancialController } from '@product/api/controllers/ApiFinancialController';

export async function GET(request: Request) {
  const controller = new ApiFinancialController();
  return await controller.getFinancialAnalytics()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';