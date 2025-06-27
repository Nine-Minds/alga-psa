/**
 * Company CSV Template API Route
 * GET /api/v1/companies/template - Download CSV template for company imports
 */

import { CompanyController } from 'server/src/lib/api/controllers/CompanyController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new CompanyController();

export async function GET(request: Request) {
  try {
    return await controller.generateTemplate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';