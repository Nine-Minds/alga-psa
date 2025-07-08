/**
 * Role Clone API Route
 * POST /api/v1/roles/{id}/clone - Clone a role
 */

import { ApiRoleController } from '@/lib/api/controllers/ApiRoleController';

const controller = new ApiRoleController();

export const POST = controller.cloneRole();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
