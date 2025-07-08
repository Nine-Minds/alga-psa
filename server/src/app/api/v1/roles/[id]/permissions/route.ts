/**
 * Role Permissions API Route
 * GET /api/v1/roles/{id}/permissions - Get role permissions
 * PUT /api/v1/roles/{id}/permissions - Assign permissions to role
 */

import { ApiRoleController } from '@/lib/api/controllers/ApiRoleController';

const controller = new ApiRoleController();

export const GET = controller.getPermissions();
export const PUT = controller.assignPermissions();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
