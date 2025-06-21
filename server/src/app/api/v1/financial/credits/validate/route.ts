/**
 * Financial Credit Validation API Route
 * POST /api/v1/financial/credits/validate - Validate credit balance
 */

import { FinancialController } from 'server/src/lib/api/controllers/FinancialController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new FinancialController();

export async function POST(request: Request) {
  try {
    return await controller.validateCreditBalance()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';