/**
 * POST /api/v1/marketing/posts/targets/[targetId]/skip - Skip a post target
 */

import { ApiMarketingController } from 'server/src/lib/api/controllers/ApiMarketingController';

const controller = new ApiMarketingController();

export async function POST(request: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.skipTarget()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
