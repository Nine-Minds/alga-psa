/**
 * Permission by ID API Route
 * GET /api/v1/permissions/[id] - Get permission by ID
 * PUT /api/v1/permissions/[id] - Update permission
 * DELETE /api/v1/permissions/[id] - Delete permission
 */

import { ApiPermissionController } from '@/lib/api/controllers/ApiPermissionController';

const controller = new ApiPermissionController();

export const GET = controller.getById();
export const PUT = controller.update();
export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';