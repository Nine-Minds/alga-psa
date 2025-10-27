/**
 * Invoice Items API Route
 * GET /api/v1/invoices/[id]/items - List invoice items
 */

import { ApiInvoiceController } from '@product/api/controllers/ApiInvoiceController';

const controller = new ApiInvoiceController();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.listItems()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';