/**
 * Remote Desktop Agents API Route
 * GET /api/v1/remote-desktop/agents - List agents
 * POST /api/v1/remote-desktop/agents - Create agent
 */

import { ApiRemoteDesktopController } from '@/lib/api/controllers/ApiRemoteDesktopController';

const controller = new ApiRemoteDesktopController();

export const GET = controller.listAgents();
export const POST = controller.createAgent();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
