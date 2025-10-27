/**
 * Financial Payment Methods API Route
 * GET /api/v1/financial/payment-methods - List payment methods
 * POST /api/v1/financial/payment-methods - Create payment method
 */

import { ApiFinancialController } from '@product/api/controllers/ApiFinancialController';

export async function GET(request: Request) {
  const controller = new ApiFinancialController();
  return await controller.list()(request as any);
}

export async function POST(request: Request) {
  const controller = new ApiFinancialController();
  return await controller.createPaymentMethod()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';