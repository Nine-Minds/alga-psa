/**
 * Roles using Permission API Route
 * GET /api/v1/permissions/[id]/roles - Get roles that have this permission
 */

import { ApiPermissionController } from '@/lib/api/controllers/ApiPermissionController';

const controller = new ApiPermissionController();

export const GET = controller.getRolesByPermission();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';