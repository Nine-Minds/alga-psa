/**
 * Financial Transactions API Route
 * GET /api/v1/financial/transactions - List transactions
 * POST /api/v1/financial/transactions - Create transaction
 */

import { ApiFinancialControllerV2 } from 'server/src/lib/api/controllers/ApiFinancialControllerV2';

export async function GET(request: Request) {
  const controller = new ApiFinancialControllerV2();
  return await controller.listTransactions()(request as any);
}

export async function POST(request: Request) {
  const controller = new ApiFinancialControllerV2();
  return await controller.createTransaction()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';