/**
 * Contacts API Routes
 * GET /api/v1/contacts - List contacts
 * POST /api/v1/contacts - Create contact
 */

import { ApiContactControllerV2 } from 'server/src/lib/api/controllers/ApiContactControllerV2';

const controller = new ApiContactControllerV2();

export async function GET(request: Request) {
  return await controller.list()(request as any);
}

export async function POST(request: Request) {
  return await controller.create()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';