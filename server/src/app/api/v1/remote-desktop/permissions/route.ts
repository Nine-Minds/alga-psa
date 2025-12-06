/**
 * Remote Desktop Permissions API Route
 * GET /api/v1/remote-desktop/permissions - List permissions
 * POST /api/v1/remote-desktop/permissions - Create permission
 */

import { ApiRemoteDesktopController } from '@/lib/api/controllers/ApiRemoteDesktopController';

const controller = new ApiRemoteDesktopController();

export const GET = controller.listPermissions();
export const POST = controller.createPermission();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
