/**
 * Client Locations API Routes (DEPRECATED)
 * GET /api/v1/clients/{id}/locations - List client locations
 * POST /api/v1/clients/{id}/locations - Create client location
 *
 */

import { ApiClientController } from '@/lib/api/controllers/ApiClientController';

const controller = new ApiClientController();

export const GET = controller.getLocations();

export const POST = controller.createLocation();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';