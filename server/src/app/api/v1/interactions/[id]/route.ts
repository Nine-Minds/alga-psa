/**
 * GET /api/v1/interactions/[id] - Get an interaction
 */

import { ApiInteractionController } from 'server/src/lib/api/controllers/ApiInteractionController';

const controller = new ApiInteractionController();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.getById()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
