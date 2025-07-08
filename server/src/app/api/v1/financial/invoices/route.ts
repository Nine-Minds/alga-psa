/**
 * Financial Invoices API Route
 * GET /api/v1/financial/invoices - List invoices for financial operations
 */

import { ApiFinancialController } from 'server/src/lib/api/controllers/ApiFinancialController';

export async function GET(request: Request) {
  const controller = new ApiFinancialController();
  return await controller.list()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';