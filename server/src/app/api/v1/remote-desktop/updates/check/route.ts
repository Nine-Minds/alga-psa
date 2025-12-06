/**
 * Agent Update Check API
 *
 * POST /api/v1/remote-desktop/updates/check
 *
 * Called by agents to check if an update is available.
 * Requires agent authentication via connection token.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getConnection, runWithTenant } from '@/lib/db/db';
import {
  checkForUpdate,
  UpdateCheckRequest,
  UpdateCheckResponse,
  AgentPlatform,
  isValidVersion,
} from '@/lib/remote-desktop/update-server';
import { UpdateRolloutManager } from '@/lib/remote-desktop/update-rollout';

interface UpdateCheckBody {
  current_version: string;
  platform: AgentPlatform;
  agent_id: string;
}

/**
 * Validate the agent's connection token
 */
async function authenticateAgent(
  request: NextRequest
): Promise<{ tenant: string; agentId: string } | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  if (!token) return null;

  // Token format: tenant:agentId:secret
  const parts = token.split(':');
  if (parts.length < 3) return null;

  const [tenant, agentId] = parts;

  const knex = await getConnection(tenant);

  // Verify token matches stored token
  const agent = await knex('rd_agents')
    .where({ tenant, agent_id: agentId, connection_token: token })
    .first();

  if (!agent) return null;

  return { tenant, agentId };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Authenticate agent
    const auth = await authenticateAgent(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Invalid or missing authentication token' },
        { status: 401 }
      );
    }

    const { tenant, agentId } = auth;
    const body: UpdateCheckBody = await request.json();

    // Validate request
    if (!body.current_version || !body.platform) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Missing required fields: current_version, platform' },
        { status: 400 }
      );
    }

    if (!isValidVersion(body.current_version)) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Invalid version format. Expected semantic version (e.g., 1.0.0)' },
        { status: 400 }
      );
    }

    if (body.platform !== 'win32' && body.platform !== 'darwin') {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Invalid platform. Must be "win32" or "darwin"' },
        { status: 400 }
      );
    }

    return await runWithTenant(tenant, async () => {
      const knex = await getConnection(tenant);

      // Check for active rollout first
      const rolloutManager = new UpdateRolloutManager(knex);
      const rolloutCheck = await rolloutManager.shouldAgentUpdate(
        tenant,
        agentId,
        body.platform,
        body.current_version
      );

      if (rolloutCheck.shouldUpdate && rolloutCheck.targetVersion) {
        // Get manifest for target version
        const updateRequest: UpdateCheckRequest = {
          currentVersion: body.current_version,
          platform: body.platform,
          agentId,
          tenantId: tenant,
        };

        const response = await checkForUpdate(updateRequest);

        // Add rollout ID to response for tracking
        if (response.updateAvailable && rolloutCheck.rolloutId) {
          (response as any).rolloutId = rolloutCheck.rolloutId;
        }

        return NextResponse.json(response);
      }

      // No rollout or not in cohort, check default update mechanism
      const updateRequest: UpdateCheckRequest = {
        currentVersion: body.current_version,
        platform: body.platform,
        agentId,
        tenantId: tenant,
      };

      const response = await checkForUpdate(updateRequest);

      // Update last_seen_at for the agent
      await knex('rd_agents')
        .where({ tenant, agent_id: agentId })
        .update({
          last_seen_at: knex.fn.now(),
          agent_version: body.current_version,
        });

      return NextResponse.json(response);
    });
  } catch (error) {
    console.error('Update check error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to check for updates' },
      { status: 500 }
    );
  }
}
