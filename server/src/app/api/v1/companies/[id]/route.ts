/**
 * Company by ID API Routes
 * GET /api/v1/companies/{id} - Get company by ID
 * PUT /api/v1/companies/{id} - Update company
 * DELETE /api/v1/companies/{id} - Delete company
 */

import { ApiCompanyControllerV2 } from '@/lib/api/controllers/ApiCompanyControllerV2';

const controller = new ApiCompanyControllerV2();

export const GET = controller.getById();

export const PUT = controller.update();

export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';