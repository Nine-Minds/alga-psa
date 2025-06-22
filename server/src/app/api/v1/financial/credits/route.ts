/**
 * Financial Credits API Route
 * GET /api/v1/financial/credits - List company credits
 */

import { FinancialController } from 'server/src/lib/api/controllers/FinancialController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new FinancialController();

export async function GET(request: Request) {
  try {
    return await controller.listCredits()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';