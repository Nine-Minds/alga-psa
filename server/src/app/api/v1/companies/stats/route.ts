/**
 * Company Statistics API Route
 * GET /api/v1/companies/stats - Get company statistics
 */

import { ApiCompanyController } from '@/lib/api/controllers/ApiCompanyController';

const controller = new ApiCompanyController();

export const GET = controller.stats();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';