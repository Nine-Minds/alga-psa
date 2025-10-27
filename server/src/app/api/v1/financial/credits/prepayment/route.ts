/**
 * Financial Prepayment Invoice API Route
 * POST /api/v1/financial/credits/prepayment - Create prepayment invoice
 */

import { ApiFinancialController } from '@product/api/controllers/ApiFinancialController';

export async function POST(request: Request) {
  const controller = new ApiFinancialController();
  return await controller.createPrepaymentInvoice()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';