/**
 * Company Statistics API Route
 * GET /api/v1/companies/stats - Get company statistics
 */

import { ApiCompanyControllerV2 } from '@/lib/api/controllers/ApiCompanyControllerV2';

const controller = new ApiCompanyControllerV2();

export const GET = controller.stats();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';