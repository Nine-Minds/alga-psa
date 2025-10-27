/**
 * Financial Bulk Credit Operations API Route
 * POST /api/v1/financial/bulk/credits - Bulk credit operations
 */

import { ApiFinancialController } from '@product/api/controllers/ApiFinancialController';

export async function POST(request: Request) {
  const controller = new ApiFinancialController();
  return await controller.bulkCreditOperations()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';