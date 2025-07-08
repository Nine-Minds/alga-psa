/**
 * Roles API Route
 * GET /api/v1/roles - List roles
 * POST /api/v1/roles - Create role
 */

import { ApiRoleController } from '@/lib/api/controllers/ApiRoleController';

const controller = new ApiRoleController();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';