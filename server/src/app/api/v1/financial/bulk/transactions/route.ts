/**
 * Financial Bulk Transaction Operations API Route
 * POST /api/v1/financial/bulk/transactions - Bulk transaction operations
 */

import { ApiFinancialController } from '@product/api/controllers/ApiFinancialController';

export async function POST(request: Request) {
  const financialController = new ApiFinancialController();
  return await financialController.bulkTransactionOperations()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';