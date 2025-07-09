/**
 * Company by ID API Routes
 * GET /api/v1/companies/{id} - Get company by ID
 * PUT /api/v1/companies/{id} - Update company
 * DELETE /api/v1/companies/{id} - Delete company
 */

import { ApiCompanyController } from '@/lib/api/controllers/ApiCompanyController';

const controller = new ApiCompanyController();

export const GET = controller.getById();

export const PUT = controller.update();

export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';