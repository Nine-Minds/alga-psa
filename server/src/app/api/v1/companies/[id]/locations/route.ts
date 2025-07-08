/**
 * Company Locations API Routes
 * GET /api/v1/companies/{id}/locations - List company locations
 * POST /api/v1/companies/{id}/locations - Create company location
 */

import { ApiCompanyController } from '@/lib/api/controllers/ApiCompanyController';

const controller = new ApiCompanyController();

export const GET = controller.getLocations();

export const POST = controller.createLocation();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';