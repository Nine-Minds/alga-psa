/**
 * Financial Payment Terms API Route
 * GET /api/v1/financial/billing/payment-terms - Get payment terms
 */

import { ApiFinancialControllerV2 } from 'server/src/lib/api/controllers/ApiFinancialControllerV2';

export async function GET(request: Request) {
  const controller = new ApiFinancialControllerV2();
  return await controller.getPaymentTerms()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';