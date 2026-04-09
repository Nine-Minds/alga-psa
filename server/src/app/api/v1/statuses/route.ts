/**
 * Statuses API Routes
 * GET /api/v1/statuses - List statuses
 * POST /api/v1/statuses - Create status
 */

import { ApiStatusController } from '@/lib/api/controllers/ApiStatusController';

const controller = new ApiStatusController();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
