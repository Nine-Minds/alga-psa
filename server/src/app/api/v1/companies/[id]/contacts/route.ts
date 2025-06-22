/**
 * Company Contacts API Route
 * GET /api/v1/companies/{id}/contacts - List company contacts
 */

import { CompanyController } from 'server/src/lib/api/controllers/CompanyController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new CompanyController();

export async function GET(request: Request) {
  try {
    return await controller.getCompanyContacts()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';