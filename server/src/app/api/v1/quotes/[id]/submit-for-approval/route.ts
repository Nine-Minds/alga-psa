/**
 * Submit Quote for Approval API Route
 * POST /api/v1/quotes/[id]/submit-for-approval - Submit for internal approval
 */

import { ApiQuoteController } from 'server/src/lib/api/controllers/ApiQuoteController';

const controller = new ApiQuoteController();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.submitForApproval()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
