/**
 * PUT /api/v1/marketing/channels/[id] - Update marketing channel
 */

import { ApiMarketingController } from 'server/src/lib/api/controllers/ApiMarketingController';

const controller = new ApiMarketingController();

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.updateChannel()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
