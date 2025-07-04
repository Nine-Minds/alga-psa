/**
 * Contact Search API Route
 * GET /api/v1/contacts/search - Advanced contact search
 */

import { ApiContactControllerV2 } from 'server/src/lib/api/controllers/ApiContactControllerV2';

const controller = new ApiContactControllerV2();

export async function GET(request: Request) {
  return await controller.search()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';