/**
 * Remote Desktop Session Events API Route
 * POST /api/v1/remote-desktop/sessions/[sessionId]/events - Log session event
 */

import { ApiRemoteDesktopController } from '@/lib/api/controllers/ApiRemoteDesktopController';

const controller = new ApiRemoteDesktopController();

export const POST = controller.logSessionEvent();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
