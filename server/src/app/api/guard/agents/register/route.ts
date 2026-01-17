/**
 * Alga Guard - Agent Registration API Route
 *
 * POST /api/guard/agents/register
 *
 * Endpoint for endpoint agents to register with the server.
 * (F294: POST /api/agents/register endpoint)
 */

import { NextRequest, NextResponse } from 'next/server';
import { registerAgent } from '@/lib/actions/guard-actions/agentActions';
import type { IAgentRegistrationRequest } from '@/interfaces/guard/agent.interfaces';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as IAgentRegistrationRequest;

    // Validate required fields
    if (!body.agent_id || !body.hostname || !body.os || !body.arch || !body.agent_version) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: agent_id, hostname, os, arch, agent_version' },
        { status: 400 }
      );
    }

    // Validate OS
    if (!['windows', 'macos', 'linux'].includes(body.os)) {
      return NextResponse.json(
        { success: false, error: 'Invalid OS: must be windows, macos, or linux' },
        { status: 400 }
      );
    }

    // Validate arch
    if (!['x86_64', 'aarch64'].includes(body.arch)) {
      return NextResponse.json(
        { success: false, error: 'Invalid arch: must be x86_64 or aarch64' },
        { status: 400 }
      );
    }

    // Either registration_token or company_id must be provided
    if (!body.registration_token && !body.company_id) {
      return NextResponse.json(
        { success: false, error: 'Either registration_token or company_id is required' },
        { status: 400 }
      );
    }

    // Register the agent
    const result = await registerAgent(body);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 401 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Agent registration route error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
