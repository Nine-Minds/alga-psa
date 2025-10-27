/**
 * Financial Credit Transfer API Route
 * POST /api/v1/financial/credits/transfer - Transfer credit between clients
 */

import { ApiFinancialController } from '@product/api/controllers/ApiFinancialController';

export async function POST(request: Request) {
  const controller = new ApiFinancialController();
  return await controller.transferCredit()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';