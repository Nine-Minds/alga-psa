/**
 * Remote Desktop Permission Detail API Route
 * GET /api/v1/remote-desktop/permissions/:permissionId - Get permission
 * PATCH /api/v1/remote-desktop/permissions/:permissionId - Update permission
 * DELETE /api/v1/remote-desktop/permissions/:permissionId - Delete permission
 */

import { ApiRemoteDesktopController } from '@/lib/api/controllers/ApiRemoteDesktopController';

const controller = new ApiRemoteDesktopController();

export const GET = controller.getPermission();
export const PATCH = controller.updatePermission();
export const DELETE = controller.deletePermission();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
