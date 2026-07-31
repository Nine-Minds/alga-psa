/**
 * POST /api/v1/marketing/sequences/enrollments/[enrollmentId]/unenroll - Stop an active enrollment
 */

import { ApiMarketingController } from 'server/src/lib/api/controllers/ApiMarketingController';

const controller = new ApiMarketingController();

export async function POST(request: Request, { params }: { params: Promise<{ enrollmentId: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.unenrollContact()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
