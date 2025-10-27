/**
 * Financial Bulk Invoice Operations API Route
 * POST /api/v1/financial/bulk/invoices - Bulk invoice operations
 */

import { ApiFinancialController } from '@product/api/controllers/ApiFinancialController';

export async function POST(request: Request) {
  const financialController = new ApiFinancialController();
  return await financialController.bulkInvoiceOperations()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';