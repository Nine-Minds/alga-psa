/**
 * Financial Aging Report API Route
 * GET /api/v1/financial/reports/aging - Get aging report
 */

import { FinancialController } from 'server/src/lib/api/controllers/FinancialController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new FinancialController();

export async function GET(request: Request) {
  try {
    return await controller.getAgingReport()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';