/**
 * Financial Credit Transfer API Route
 * POST /api/v1/financial/credits/transfer - Transfer credit between companies
 */

import { FinancialController } from 'server/src/lib/api/controllers/FinancialController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new FinancialController();

export async function POST(request: Request) {
  try {
    return await controller.transferCredit()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';