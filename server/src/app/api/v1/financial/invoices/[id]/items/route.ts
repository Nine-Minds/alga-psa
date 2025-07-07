/**
 * Financial Invoice Items API Route
 * POST /api/v1/financial/invoices/[id]/items - Add manual item to invoice
 */

import { ApiFinancialControllerV2 } from 'server/src/lib/api/controllers/ApiFinancialControllerV2';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const controller = new ApiFinancialControllerV2();
  const req = request as any;
  req.params = params;
  return await controller.create()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';