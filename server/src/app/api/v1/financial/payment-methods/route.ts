/**
 * Financial Payment Methods API Route
 * GET /api/v1/financial/payment-methods - List payment methods
 * POST /api/v1/financial/payment-methods - Create payment method
 */

import { FinancialController } from 'server/src/lib/api/controllers/FinancialController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new FinancialController();
    return await controller.list()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new FinancialController();
    return await controller.createPaymentMethod()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';