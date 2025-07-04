/**
 * Company Locations API Routes
 * GET /api/v1/companies/{id}/locations - List company locations
 * POST /api/v1/companies/{id}/locations - Create company location
 */

import { ApiCompanyControllerV2 } from '@/lib/api/controllers/ApiCompanyControllerV2';

const controller = new ApiCompanyControllerV2();

export const GET = controller.getLocations();

export const POST = controller.createLocation();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';