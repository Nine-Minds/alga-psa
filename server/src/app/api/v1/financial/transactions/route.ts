/**
 * Financial Transactions API Route
 * GET /api/v1/financial/transactions - List transactions
 * POST /api/v1/financial/transactions - Create transaction
 */

import { ApiFinancialController } from '@product/api/controllers/ApiFinancialController';

export async function GET(request: Request) {
  const controller = new ApiFinancialController();
  return await controller.listTransactions()(request as any);
}

export async function POST(request: Request) {
  const controller = new ApiFinancialController();
  return await controller.createTransaction()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';