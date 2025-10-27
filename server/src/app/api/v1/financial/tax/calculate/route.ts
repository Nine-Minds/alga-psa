/**
 * Financial Tax Calculation API Route
 * POST /api/v1/financial/tax/calculate - Calculate tax for billing
 */

import { ApiFinancialController } from '@product/api/controllers/ApiFinancialController';

export async function POST(request: Request) {
  const controller = new ApiFinancialController();
  return await controller.calculateTax()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';