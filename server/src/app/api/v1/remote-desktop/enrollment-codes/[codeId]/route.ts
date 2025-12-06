/**
 * Remote Desktop Enrollment Code API Route
 * DELETE /api/v1/remote-desktop/enrollment-codes/:codeId - Revoke enrollment code
 */

import { ApiRemoteDesktopController } from '@/lib/api/controllers/ApiRemoteDesktopController';

const controller = new ApiRemoteDesktopController();

export const DELETE = controller.revokeEnrollmentCode();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
