/**
 * GET /api/v1/marketing/sequences - List nurture sequences
 * POST /api/v1/marketing/sequences - Create nurture sequence
 */

import { ApiMarketingController } from 'server/src/lib/api/controllers/ApiMarketingController';

const controller = new ApiMarketingController();

export async function GET(request: Request) {
  return controller.listSequences()(request as any);
}

export async function POST(request: Request) {
  return controller.createSequence()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
