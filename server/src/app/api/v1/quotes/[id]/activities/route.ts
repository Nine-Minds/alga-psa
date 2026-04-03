/**
 * Quote Activities API Route
 * GET /api/v1/quotes/[id]/activities - Get quote audit/activity log
 */

import { ApiQuoteController } from 'server/src/lib/api/controllers/ApiQuoteController';

const controller = new ApiQuoteController();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.listActivities()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
