/**
 * Status by ID API Routes
 * GET /api/v1/statuses/:id - Get status by ID
 * PUT /api/v1/statuses/:id - Update status
 * DELETE /api/v1/statuses/:id - Delete status
 */

import { ApiStatusController } from '@/lib/api/controllers/ApiStatusController';

const controller = new ApiStatusController();

export const GET = controller.getById();
export const PUT = controller.update();
export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
