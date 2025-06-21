/**
 * Financial Payment Terms API Route
 * GET /api/v1/financial/billing/payment-terms - Get payment terms
 */

import { FinancialController } from 'server/src/lib/api/controllers/FinancialController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new FinancialController();

export async function GET(request: Request) {
  try {
    return await controller.getPaymentTerms()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';