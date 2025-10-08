/**
 * Client Statistics API Route
 * GET /api/v1/clients/stats - Get client statistics
 *
 * This is the new endpoint for client statistics.
 * Old /api/v1/clients/stats endpoint is deprecated but still supported.
 */

import { ApiClientController } from '@/lib/api/controllers/ApiClientController';

const controller = new ApiClientController();

export const GET = controller.stats();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
