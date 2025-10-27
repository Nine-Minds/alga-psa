/**
 * Financial Billing Calculation API Route
 * POST /api/v1/financial/billing/calculate - Calculate billing for client
 */

import { ApiFinancialController } from '@product/api/controllers/ApiFinancialController';

export async function POST(request: Request) {
  const controller = new ApiFinancialController();
  return await controller.calculateBilling()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';