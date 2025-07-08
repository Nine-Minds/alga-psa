/**
 * Roles Bulk Operations API Route
 * POST /api/v1/roles/bulk - Bulk create roles
 */

import { ApiRoleController } from '@/lib/api/controllers/ApiRoleController';

const controller = new ApiRoleController();

export const POST = controller.bulkCreate();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
