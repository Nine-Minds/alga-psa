/**
 * Invoice Tax Calculation API Route
 * POST /api/v1/invoices/[id]/tax - Calculate tax for invoice
 */

import { ApiInvoiceController } from 'server/src/lib/api/controllers/ApiInvoiceController';

const controller = new ApiInvoiceController();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.calculateTax()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';