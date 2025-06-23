/**
 * Contacts API Routes
 * GET /api/v1/contacts - List contacts
 * POST /api/v1/contacts - Create contact
 */

import { ContactController } from 'server/src/lib/api/controllers/ContactController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ContactController();

export async function GET(request: Request) {
  try {
    return await controller.list()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await controller.create()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';