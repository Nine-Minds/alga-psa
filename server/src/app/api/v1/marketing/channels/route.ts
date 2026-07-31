/**
 * GET /api/v1/marketing/channels - List marketing channels
 * POST /api/v1/marketing/channels - Create marketing channel
 */

import { ApiMarketingController } from 'server/src/lib/api/controllers/ApiMarketingController';

const controller = new ApiMarketingController();

export async function GET(request: Request) {
  return controller.listChannels()(request as any);
}

export async function POST(request: Request) {
  return controller.createChannel()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
