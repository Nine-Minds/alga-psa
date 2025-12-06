/**
 * Remote Desktop Session by ID API Route
 * GET /api/v1/remote-desktop/sessions/[sessionId] - Get session details
 * DELETE /api/v1/remote-desktop/sessions/[sessionId] - End session
 */

import { ApiRemoteDesktopController } from '@/lib/api/controllers/ApiRemoteDesktopController';

const controller = new ApiRemoteDesktopController();

export const GET = controller.getSession();
export const DELETE = controller.endSession();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
