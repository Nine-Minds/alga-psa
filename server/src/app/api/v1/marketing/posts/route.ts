/**
 * POST /api/v1/marketing/posts - Create a social post with per-channel targets
 */

import { ApiMarketingController } from 'server/src/lib/api/controllers/ApiMarketingController';

const controller = new ApiMarketingController();

export async function POST(request: Request) {
  return controller.createPost()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
