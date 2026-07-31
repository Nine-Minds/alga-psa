/**
 * GET /api/v1/marketing/content - List marketing content
 * POST /api/v1/marketing/content - Create marketing content
 */

import { ApiMarketingController } from 'server/src/lib/api/controllers/ApiMarketingController';

const controller = new ApiMarketingController();

export async function GET(request: Request) {
  return controller.listContent()(request as any);
}

export async function POST(request: Request) {
  return controller.createContent()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
