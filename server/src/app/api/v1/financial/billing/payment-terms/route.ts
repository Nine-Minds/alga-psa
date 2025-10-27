/**
 * Financial Payment Terms API Route
 * GET /api/v1/financial/billing/payment-terms - Get payment terms
 */

import { ApiFinancialController } from '@product/api/controllers/ApiFinancialController';

export async function GET(request: Request) {
  const controller = new ApiFinancialController();
  return await controller.getPaymentTerms()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';