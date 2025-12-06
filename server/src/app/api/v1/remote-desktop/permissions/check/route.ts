/**
 * Remote Desktop Permission Check API Route
 * GET /api/v1/remote-desktop/permissions/check - Check user permission
 */

import { ApiRemoteDesktopController } from '@/lib/api/controllers/ApiRemoteDesktopController';

const controller = new ApiRemoteDesktopController();

export const GET = controller.checkPermission();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
