/**
 * Companies API Routes
 * GET /api/v1/companies - List companies
 * POST /api/v1/companies - Create company
 */

import { CompanyController } from 'server/src/lib/api/controllers/CompanyController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new CompanyController();

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