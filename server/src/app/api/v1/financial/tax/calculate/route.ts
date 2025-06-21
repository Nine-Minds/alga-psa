/**
 * Financial Tax Calculation API Route
 * POST /api/v1/financial/tax/calculate - Calculate tax for billing
 */

import { FinancialController } from 'server/src/lib/api/controllers/FinancialController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new FinancialController();

export async function POST(request: Request) {
  try {
    return await controller.calculateTax()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';