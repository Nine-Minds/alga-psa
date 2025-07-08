/**
 * Permissions API Route
 * GET /api/v1/permissions - List permissions
 * POST /api/v1/permissions - Create permission
 */

import { ApiPermissionController } from '@/lib/api/controllers/ApiPermissionController';

const controller = new ApiPermissionController();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';