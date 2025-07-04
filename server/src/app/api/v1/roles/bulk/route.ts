/**
 * Roles Bulk Operations API Route
 * POST /api/v1/roles/bulk - Bulk create roles
 */

import { ApiRoleControllerV2 } from '@/lib/api/controllers/ApiRoleControllerV2';

const controller = new ApiRoleControllerV2();

export const POST = controller.bulkCreate();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
