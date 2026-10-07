/**
 * Countries API Routes
 * GET /api/v1/countries - List active ISO countries (global reference data)
 */

import { ApiCountryController } from '@/lib/api/controllers/ApiCountryController';

const controller = new ApiCountryController();

export const GET = controller.list();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
