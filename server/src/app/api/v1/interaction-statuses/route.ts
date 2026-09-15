/**
 * GET /api/v1/interaction-statuses - List interaction statuses for the tenant
 */
import { ApiInteractionController } from 'server/src/lib/api/controllers/ApiInteractionController';

const controller = new ApiInteractionController();

export async function GET(request: Request) {
  return controller.listStatuses()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
