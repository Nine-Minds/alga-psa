/**
 * Status by ID API Routes
 * GET /api/v1/statuses/:id - Get status by ID
 */

import { ApiStatusController } from '@/lib/api/controllers/ApiStatusController';

const controller = new ApiStatusController();

export const GET = controller.getById();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
