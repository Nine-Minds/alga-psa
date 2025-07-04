/**
 * Role Permissions API Route
 * GET /api/v1/roles/{id}/permissions - Get role permissions
 * PUT /api/v1/roles/{id}/permissions - Assign permissions to role
 */

import { ApiRoleControllerV2 } from '@/lib/api/controllers/ApiRoleControllerV2';

const controller = new ApiRoleControllerV2();

export const GET = controller.getPermissions();
export const PUT = controller.assignPermissions();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
