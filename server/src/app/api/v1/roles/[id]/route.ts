/**
 * Role by ID API Route
 * GET /api/v1/roles/[id] - Get role by ID
 * PUT /api/v1/roles/[id] - Update role
 * DELETE /api/v1/roles/[id] - Delete role
 */

import { ApiRoleController } from '@/lib/api/controllers/ApiRoleController';

const controller = new ApiRoleController();

export const GET = controller.getById();
export const PUT = controller.update();
export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';