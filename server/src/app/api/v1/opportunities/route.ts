/**
 * GET /api/v1/opportunities - List opportunities
 * POST /api/v1/opportunities - Create opportunity
 */

import { ApiOpportunityController } from 'server/src/lib/api/controllers/ApiOpportunityController';

const controller = new ApiOpportunityController();

export async function GET(request: Request) {
  return controller.list()(request as any);
}

export async function POST(request: Request) {
  return controller.create()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
