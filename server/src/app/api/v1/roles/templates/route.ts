/**
 * Role Templates API Route
 * GET /api/v1/roles/templates - Get role templates
 */

import { ApiRoleController } from '@/lib/api/controllers/ApiRoleController';

const controller = new ApiRoleController();

export const GET = controller.getTemplates();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';