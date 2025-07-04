/**
 * Roles API Route
 * GET /api/v1/roles - List roles
 * POST /api/v1/roles - Create role
 */

import { ApiRoleControllerV2 } from '@/lib/api/controllers/ApiRoleControllerV2';

const controller = new ApiRoleControllerV2();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';