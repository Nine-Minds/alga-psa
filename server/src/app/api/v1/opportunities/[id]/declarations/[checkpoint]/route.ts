/**
 * PUT /api/v1/opportunities/[id]/declarations/[checkpoint] - Edit a stage declaration's note and sources
 */

import { ApiOpportunityController } from 'server/src/lib/api/controllers/ApiOpportunityController';

const controller = new ApiOpportunityController();

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; checkpoint: string }> },
) {
  const req = request as any;
  req.params = params;
  return controller.amendDeclaration()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
