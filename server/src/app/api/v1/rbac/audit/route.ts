/**
 * RBAC Audit API Route
 * GET /api/v1/rbac/audit - List RBAC audit-log entries (role/permission/user-role changes)
 */

import { ApiPermissionController } from '@/lib/api/controllers/ApiPermissionController';

const controller = new ApiPermissionController();

export const GET = controller.audit();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
