/**
 * GET /api/v1/interaction-types - List system and tenant interaction types
 */

import { ApiInteractionController } from 'server/src/lib/api/controllers/ApiInteractionController';

const controller = new ApiInteractionController();

export async function GET(request: Request) {
  return controller.listTypes()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
