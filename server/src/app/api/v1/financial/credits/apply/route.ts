/**
 * Financial Credit Application API Route
 * POST /api/v1/financial/credits/apply - Apply credit to invoice
 */

import { ApiFinancialControllerV2 } from 'server/src/lib/api/controllers/ApiFinancialControllerV2';

export async function POST(request: Request) {
  const controller = new ApiFinancialControllerV2();
  return await controller.applyCreditToInvoice()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';