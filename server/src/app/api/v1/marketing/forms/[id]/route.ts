/**
 * PUT /api/v1/marketing/forms/[id] - Update capture form
 */

import { ApiMarketingController } from 'server/src/lib/api/controllers/ApiMarketingController';

const controller = new ApiMarketingController();

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.updateForm()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
