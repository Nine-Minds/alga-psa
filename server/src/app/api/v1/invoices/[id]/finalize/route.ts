/**
 * Invoice Finalize API Route
 * POST /api/v1/invoices/[id]/finalize - Finalize invoice
 */

import { ApiInvoiceControllerV2 } from 'server/src/lib/api/controllers/ApiInvoiceControllerV2';

const controller = new ApiInvoiceControllerV2();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.finalize()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';