/**
 * Financial Credit Application API Route
 * POST /api/v1/financial/credits/apply - Apply credit to invoice
 */

import { ApiFinancialController } from '@product/api/controllers/ApiFinancialController';

export async function POST(request: Request) {
  const controller = new ApiFinancialController();
  return await controller.applyCreditToInvoice()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';