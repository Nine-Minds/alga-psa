/**
 * Services API Routes
 * GET /api/v1/services - List services
 * POST /api/v1/services - Create service
 */

import { ApiServiceController } from '@/lib/api/controllers/ApiServiceController';

const controller = new ApiServiceController();

export const GET = controller.list();

export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
