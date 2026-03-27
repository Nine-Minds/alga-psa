/**
 * Quote Conversion Preview API Route
 * GET /api/v1/quotes/[id]/convert/preview - Preview conversion options
 */

import { ApiQuoteController } from 'server/src/lib/api/controllers/ApiQuoteController';

const controller = new ApiQuoteController();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.conversionPreview()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
