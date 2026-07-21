/**
 * POST /api/v1/marketing/sequences/[id]/enroll - Enroll a contact in a nurture sequence
 */

import { ApiMarketingController } from 'server/src/lib/api/controllers/ApiMarketingController';

const controller = new ApiMarketingController();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.enrollContact()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
