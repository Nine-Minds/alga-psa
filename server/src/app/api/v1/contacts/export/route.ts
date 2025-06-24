/**
 * Contact Export API Route
 * GET /api/v1/contacts/export - Export contacts to CSV or JSON
 */

import { ContactController } from 'server/src/lib/api/controllers/ContactController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ContactController();

export async function GET(request: Request) {
  try {
    return await controller.exportContacts()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';