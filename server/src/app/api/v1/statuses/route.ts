/**
 * Statuses API Routes
 * GET /api/v1/statuses - List statuses
 */

import { ApiStatusController } from '@/lib/api/controllers/ApiStatusController';

const controller = new ApiStatusController();

export const GET = controller.list();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
