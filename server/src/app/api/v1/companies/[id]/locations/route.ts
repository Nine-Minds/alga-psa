/**
 * Company Locations API Routes
 * GET /api/v1/companies/{id}/locations - List company locations
 * POST /api/v1/companies/{id}/locations - Create company location
 */

import { CompanyController } from 'server/src/lib/api/controllers/CompanyController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new CompanyController();

export async function GET(request: Request) {
  try {
    return await controller.getCompanyLocations()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await controller.createCompanyLocation()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';