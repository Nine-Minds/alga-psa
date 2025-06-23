/**
 * Company by ID API Routes
 * GET /api/v1/companies/{id} - Get company by ID
 * PUT /api/v1/companies/{id} - Update company
 * DELETE /api/v1/companies/{id} - Delete company
 */

import { CompanyController } from 'server/src/lib/api/controllers/CompanyController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new CompanyController();

export async function GET(request: Request) {
  try {
    return await controller.getById()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    return await controller.update()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    return await controller.delete()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';