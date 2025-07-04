/**
 * Permissions API Route
 * GET /api/v1/permissions - List permissions
 * POST /api/v1/permissions - Create permission
 */

import { ApiPermissionControllerV2 } from '@/lib/api/controllers/ApiPermissionControllerV2';

const controller = new ApiPermissionControllerV2();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';