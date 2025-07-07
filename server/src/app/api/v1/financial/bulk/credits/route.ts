/**
 * Financial Bulk Credit Operations API Route
 * POST /api/v1/financial/bulk/credits - Bulk credit operations
 */

import { ApiFinancialControllerV2 } from 'server/src/lib/api/controllers/ApiFinancialControllerV2';

export async function POST(request: Request) {
  const controller = new ApiFinancialControllerV2();
  return await controller.bulkCreditOperations()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';