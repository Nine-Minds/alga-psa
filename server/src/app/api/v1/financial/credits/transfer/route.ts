/**
 * Financial Credit Transfer API Route
 * POST /api/v1/financial/credits/transfer - Transfer credit between companies
 */

import { ApiFinancialControllerV2 } from 'server/src/lib/api/controllers/ApiFinancialControllerV2';

export async function POST(request: Request) {
  const controller = new ApiFinancialControllerV2();
  return await controller.transferCredit()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';