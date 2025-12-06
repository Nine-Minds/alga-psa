/**
 * Remote Desktop Agent by ID API Route
 * GET /api/v1/remote-desktop/agents/[agentId] - Get agent by ID
 * PUT /api/v1/remote-desktop/agents/[agentId] - Update agent
 * DELETE /api/v1/remote-desktop/agents/[agentId] - Delete agent
 */

import { ApiRemoteDesktopController } from '@/lib/api/controllers/ApiRemoteDesktopController';

const controller = new ApiRemoteDesktopController();

export const GET = controller.getAgent();
export const PUT = controller.updateAgent();
export const DELETE = controller.deleteAgent();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
