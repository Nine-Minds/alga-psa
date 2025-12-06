/**
 * Remote Desktop Agent Enrollment API Route
 * POST /api/v1/remote-desktop/agents/enroll - Enroll agent with enrollment code
 *
 * This endpoint does not require API key authentication - it uses enrollment codes.
 */

import { ApiRemoteDesktopController } from '@/lib/api/controllers/ApiRemoteDesktopController';

const controller = new ApiRemoteDesktopController();

export const POST = controller.enrollAgent();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
