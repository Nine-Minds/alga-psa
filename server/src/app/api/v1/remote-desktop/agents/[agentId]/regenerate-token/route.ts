/**
 * Remote Desktop Agent Regenerate Token API Route
 * POST /api/v1/remote-desktop/agents/[agentId]/regenerate-token - Regenerate connection token
 */

import { ApiRemoteDesktopController } from '@/lib/api/controllers/ApiRemoteDesktopController';

const controller = new ApiRemoteDesktopController();

export const POST = controller.regenerateAgentToken();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
