/**
 * Alga Guard - Agent Heartbeat API Route
 *
 * POST /api/guard/agents/heartbeat
 *
 * Endpoint for endpoint agents to send heartbeat and receive commands.
 */

import { NextRequest, NextResponse } from 'next/server';
import { agentHeartbeat } from '@/lib/actions/guard-actions/agentActions';
import type { IAgentHeartbeatRequest } from '@/interfaces/guard/agent.interfaces';
import { auth } from '@/app/api/auth/[...nextauth]/auth';

export async function POST(request: NextRequest) {
  try {
    // Get session for tenant context
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const tenantId = (session.user as { tenant?: string }).tenant;
    if (!tenantId) {
      return NextResponse.json(
        { success: false, error: 'No tenant context' },
        { status: 401 }
      );
    }

    const body = await request.json() as IAgentHeartbeatRequest;

    // Validate required fields
    if (!body.agent_id || !body.status) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: agent_id, status' },
        { status: 400 }
      );
    }

    // Process heartbeat
    const result = await agentHeartbeat(body, tenantId);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Agent heartbeat route error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
