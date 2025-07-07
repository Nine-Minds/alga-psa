/**
 * Financial Billing Calculation API Route
 * POST /api/v1/financial/billing/calculate - Calculate billing for company
 */

import { ApiFinancialControllerV2 } from 'server/src/lib/api/controllers/ApiFinancialControllerV2';

export async function POST(request: Request) {
  const controller = new ApiFinancialControllerV2();
  return await controller.calculateBilling()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';