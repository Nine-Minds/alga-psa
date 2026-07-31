/**
 * GET /api/v1/marketing/posts/awaiting-publish - Agent publish loop reading list
 */

import { ApiMarketingController } from 'server/src/lib/api/controllers/ApiMarketingController';

const controller = new ApiMarketingController();

export async function GET(request: Request) {
  return controller.getAwaitingPublish()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
