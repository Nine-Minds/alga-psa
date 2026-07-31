/**
 * GET /api/v1/interactions - List interactions
 * POST /api/v1/interactions - Create an interaction
 */

import { ApiInteractionController } from 'server/src/lib/api/controllers/ApiInteractionController';

const controller = new ApiInteractionController();

export async function GET(request: Request) {
  return controller.list()(request as any);
}

export async function POST(request: Request) {
  return controller.create()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
