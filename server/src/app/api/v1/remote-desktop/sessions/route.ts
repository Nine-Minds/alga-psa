/**
 * Remote Desktop Sessions API Route
 * GET /api/v1/remote-desktop/sessions - List sessions
 * POST /api/v1/remote-desktop/sessions - Create session
 */

import { ApiRemoteDesktopController } from '@/lib/api/controllers/ApiRemoteDesktopController';

const controller = new ApiRemoteDesktopController();

export const GET = controller.listSessions();
export const POST = controller.createSession();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
