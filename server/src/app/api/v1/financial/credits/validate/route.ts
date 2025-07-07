/**
 * Financial Credit Validation API Route
 * POST /api/v1/financial/credits/validate - Validate credit balance
 */

import { ApiFinancialControllerV2 } from 'server/src/lib/api/controllers/ApiFinancialControllerV2';

export async function POST(request: Request) {
  const controller = new ApiFinancialControllerV2();
  return await controller.validateCreditBalance()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';