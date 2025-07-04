/**
 * Role Templates API Route
 * GET /api/v1/roles/templates - Get role templates
 */

import { ApiRoleControllerV2 } from '@/lib/api/controllers/ApiRoleControllerV2';

const controller = new ApiRoleControllerV2();

export const GET = controller.getTemplates();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';