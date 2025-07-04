/**
 * Contact Statistics API Route
 * GET /api/v1/contacts/stats - Get contact statistics
 */

import { ApiContactControllerV2 } from 'server/src/lib/api/controllers/ApiContactControllerV2';

const controller = new ApiContactControllerV2();

export async function GET(request: Request) {
  return await controller.stats()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';