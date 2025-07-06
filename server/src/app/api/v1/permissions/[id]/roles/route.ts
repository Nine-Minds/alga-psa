/**
 * Roles using Permission API Route
 * GET /api/v1/permissions/[id]/roles - Get roles that have this permission
 */

import { ApiPermissionControllerV2 } from '@/lib/api/controllers/ApiPermissionControllerV2';

const controller = new ApiPermissionControllerV2();

export const GET = controller.getRolesByPermission();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';