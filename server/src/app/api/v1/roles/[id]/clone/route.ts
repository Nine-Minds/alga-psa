/**
 * Role Clone API Route
 * POST /api/v1/roles/{id}/clone - Clone a role
 */

import { ApiRoleControllerV2 } from '@/lib/api/controllers/ApiRoleControllerV2';

const controller = new ApiRoleControllerV2();

export const POST = controller.cloneRole();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
