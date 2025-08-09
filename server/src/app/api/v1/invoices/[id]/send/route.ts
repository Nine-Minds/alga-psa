/**
 * Invoice Send API Route
 * POST /api/v1/invoices/[id]/send - Send invoice to customer
 */

import { ApiInvoiceController } from 'server/src/lib/api/controllers/ApiInvoiceController';

const controller = new ApiInvoiceController();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.send()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';