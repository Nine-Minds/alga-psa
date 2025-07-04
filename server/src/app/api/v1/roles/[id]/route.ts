/**
 * Role by ID API Route
 * GET /api/v1/roles/[id] - Get role by ID
 * PUT /api/v1/roles/[id] - Update role
 * DELETE /api/v1/roles/[id] - Delete role
 */

import { ApiRoleControllerV2 } from '@/lib/api/controllers/ApiRoleControllerV2';

const controller = new ApiRoleControllerV2();

export const GET = controller.getById();
export const PUT = controller.update();
export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';