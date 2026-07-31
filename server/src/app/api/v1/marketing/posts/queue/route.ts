/**
 * GET /api/v1/marketing/posts/queue - List social post targets (publish queue)
 */

import { ApiMarketingController } from 'server/src/lib/api/controllers/ApiMarketingController';

const controller = new ApiMarketingController();

export async function GET(request: Request) {
  return controller.getPostQueue()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
