/**
 * Remote Desktop Enrollment Codes API Route
 * GET /api/v1/remote-desktop/enrollment-codes - List enrollment codes
 * POST /api/v1/remote-desktop/enrollment-codes - Create enrollment code
 */

import { ApiRemoteDesktopController } from '@/lib/api/controllers/ApiRemoteDesktopController';

const controller = new ApiRemoteDesktopController();

export const GET = controller.listEnrollmentCodes();
export const POST = controller.createEnrollmentCode();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
