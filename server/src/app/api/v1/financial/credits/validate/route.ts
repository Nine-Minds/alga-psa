/**
 * Financial Credit Validation API Route
 * POST /api/v1/financial/credits/validate - Validate credit balance
 */

import { ApiFinancialController } from '@product/api/controllers/ApiFinancialController';

export async function POST(request: Request) {
  const controller = new ApiFinancialController();
  return await controller.validateCreditBalance()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';