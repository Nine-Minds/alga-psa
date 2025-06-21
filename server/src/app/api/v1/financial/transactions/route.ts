/**
 * Financial Transactions API Route
 * GET /api/v1/financial/transactions - List transactions
 * POST /api/v1/financial/transactions - Create transaction
 */

import { FinancialController } from 'server/src/lib/api/controllers/FinancialController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new FinancialController();

export async function GET(request: Request) {
  try {
    return await controller.listTransactions()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await controller.createTransaction()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';