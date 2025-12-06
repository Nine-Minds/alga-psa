/**
 * Remote Desktop Integration Tests
 *
 * Tests for the remote desktop tables, API endpoints, and signaling functionality.
 */

import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { TestContext } from '../../../test-utils/testContext';
import { setupCommonMocks, createMockUser, mockGetCurrentUser } from '../../../test-utils/testMocks';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 120_000;

describe('Remote Desktop Integration', () => {
  let ctx: TestContext;
  let agentId: string;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: ['rd_session_events', 'rd_sessions', 'rd_agents']
    });
    setupCommonMocks({
      tenantId: ctx.tenantId,
      userId: ctx.user.user_id,
      user: ctx.user
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    const adminUser = createMockUser('internal', {
      user_id: ctx.user.user_id,
      tenant: ctx.tenantId,
      roles: ctx.user.roles && ctx.user.roles.length > 0 ? ctx.user.roles : [
        {
          role_id: 'admin-role',
          tenant: ctx.tenantId,
          role_name: 'Admin',
          permissions: []
        }
      ]
    });
    setupCommonMocks({
      tenantId: ctx.tenantId,
      userId: adminUser.user_id,
      user: adminUser,
      permissionCheck: () => true
    });
    mockGetCurrentUser(adminUser);
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  describe('Agent CRUD Operations', () => {
    it('creates an agent record with required fields', async () => {
      const [agent] = await ctx.db('rd_agents')
        .insert({
          tenant: ctx.tenantId,
          agent_name: 'Test Agent',
          hostname: 'TEST-WIN-01',
          os_type: 'windows',
          os_version: '10.0.19045',
          agent_version: '0.1.0',
          status: 'offline',
          connection_token: `${ctx.tenantId}:test-agent-id:test-secret`,
          metadata: { ip_address: '192.168.1.100' }
        })
        .returning('*');

      expect(agent).toBeDefined();
      expect(agent.agent_name).toBe('Test Agent');
      expect(agent.hostname).toBe('TEST-WIN-01');
      expect(agent.os_type).toBe('windows');
      expect(agent.status).toBe('offline');

      agentId = agent.agent_id;
    });

    it('lists agents for a tenant', async () => {
      // Create test agents
      await ctx.db('rd_agents').insert([
        {
          tenant: ctx.tenantId,
          agent_name: 'Agent 1',
          hostname: 'HOST-01',
          os_type: 'windows',
          agent_version: '0.1.0',
          status: 'online',
          connection_token: `${ctx.tenantId}:agent1:secret1`
        },
        {
          tenant: ctx.tenantId,
          agent_name: 'Agent 2',
          hostname: 'HOST-02',
          os_type: 'macos',
          agent_version: '0.1.0',
          status: 'offline',
          connection_token: `${ctx.tenantId}:agent2:secret2`
        }
      ]);

      const agents = await ctx.db('rd_agents')
        .where({ tenant: ctx.tenantId })
        .orderBy('agent_name', 'asc');

      expect(agents.length).toBeGreaterThanOrEqual(2);

      const onlineAgents = agents.filter((a: any) => a.status === 'online');
      expect(onlineAgents.length).toBeGreaterThanOrEqual(1);
    });

    it('updates agent status', async () => {
      const [agent] = await ctx.db('rd_agents')
        .insert({
          tenant: ctx.tenantId,
          agent_name: 'Status Test Agent',
          hostname: 'STATUS-HOST',
          os_type: 'windows',
          agent_version: '0.1.0',
          status: 'offline',
          connection_token: `${ctx.tenantId}:status-agent:secret`
        })
        .returning('*');

      // Update status to online
      await ctx.db('rd_agents')
        .where({ tenant: ctx.tenantId, agent_id: agent.agent_id })
        .update({
          status: 'online',
          last_seen_at: ctx.db.fn.now()
        });

      const updated = await ctx.db('rd_agents')
        .where({ tenant: ctx.tenantId, agent_id: agent.agent_id })
        .first();

      expect(updated.status).toBe('online');
      expect(updated.last_seen_at).toBeDefined();
    });

    it('deletes an agent and cascades to sessions', async () => {
      // Create agent
      const [agent] = await ctx.db('rd_agents')
        .insert({
          tenant: ctx.tenantId,
          agent_name: 'Delete Test Agent',
          hostname: 'DELETE-HOST',
          os_type: 'windows',
          agent_version: '0.1.0',
          status: 'online',
          connection_token: `${ctx.tenantId}:delete-agent:secret`
        })
        .returning('*');

      // Create a session for this agent
      const [session] = await ctx.db('rd_sessions')
        .insert({
          tenant: ctx.tenantId,
          agent_id: agent.agent_id,
          engineer_user_id: ctx.user.user_id,
          status: 'pending'
        })
        .returning('*');

      // Delete agent - should cascade
      await ctx.db('rd_agents')
        .where({ tenant: ctx.tenantId, agent_id: agent.agent_id })
        .delete();

      // Verify agent is deleted
      const deletedAgent = await ctx.db('rd_agents')
        .where({ tenant: ctx.tenantId, agent_id: agent.agent_id })
        .first();
      expect(deletedAgent).toBeUndefined();

      // Verify session was also deleted (cascade)
      const deletedSession = await ctx.db('rd_sessions')
        .where({ tenant: ctx.tenantId, session_id: session.session_id })
        .first();
      expect(deletedSession).toBeUndefined();
    });
  });

  describe('Session Management', () => {
    let testAgent: any;

    beforeEach(async () => {
      [testAgent] = await ctx.db('rd_agents')
        .insert({
          tenant: ctx.tenantId,
          agent_name: 'Session Test Agent',
          hostname: 'SESSION-HOST',
          os_type: 'windows',
          agent_version: '0.1.0',
          status: 'online',
          connection_token: `${ctx.tenantId}:session-agent:${Date.now()}`
        })
        .returning('*');
    });

    it('creates a session record', async () => {
      const [session] = await ctx.db('rd_sessions')
        .insert({
          tenant: ctx.tenantId,
          agent_id: testAgent.agent_id,
          engineer_user_id: ctx.user.user_id,
          status: 'pending'
        })
        .returning('*');

      expect(session).toBeDefined();
      expect(session.status).toBe('pending');
      expect(session.agent_id).toBe(testAgent.agent_id);
      expect(session.engineer_user_id).toBe(ctx.user.user_id);
    });

    it('updates session status through lifecycle', async () => {
      // Create pending session
      const [session] = await ctx.db('rd_sessions')
        .insert({
          tenant: ctx.tenantId,
          agent_id: testAgent.agent_id,
          engineer_user_id: ctx.user.user_id,
          status: 'pending'
        })
        .returning('*');

      expect(session.status).toBe('pending');

      // Update to active
      await ctx.db('rd_sessions')
        .where({ tenant: ctx.tenantId, session_id: session.session_id })
        .update({
          status: 'active',
          started_at: ctx.db.fn.now()
        });

      let updated = await ctx.db('rd_sessions')
        .where({ tenant: ctx.tenantId, session_id: session.session_id })
        .first();
      expect(updated.status).toBe('active');
      expect(updated.started_at).toBeDefined();

      // Update to ended
      await ctx.db('rd_sessions')
        .where({ tenant: ctx.tenantId, session_id: session.session_id })
        .update({
          status: 'ended',
          ended_at: ctx.db.fn.now(),
          end_reason: 'user_disconnect',
          duration_seconds: 300
        });

      updated = await ctx.db('rd_sessions')
        .where({ tenant: ctx.tenantId, session_id: session.session_id })
        .first();
      expect(updated.status).toBe('ended');
      expect(updated.end_reason).toBe('user_disconnect');
      expect(updated.duration_seconds).toBe(300);
    });

    it('lists sessions with filters', async () => {
      // Create multiple sessions
      await ctx.db('rd_sessions').insert([
        {
          tenant: ctx.tenantId,
          agent_id: testAgent.agent_id,
          engineer_user_id: ctx.user.user_id,
          status: 'active'
        },
        {
          tenant: ctx.tenantId,
          agent_id: testAgent.agent_id,
          engineer_user_id: ctx.user.user_id,
          status: 'ended',
          end_reason: 'user_disconnect'
        }
      ]);

      // Filter by status
      const activeSessions = await ctx.db('rd_sessions')
        .where({ tenant: ctx.tenantId, status: 'active' });

      const endedSessions = await ctx.db('rd_sessions')
        .where({ tenant: ctx.tenantId, status: 'ended' });

      expect(activeSessions.length).toBeGreaterThanOrEqual(1);
      expect(endedSessions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Session Events', () => {
    let testAgent: any;
    let testSession: any;

    beforeEach(async () => {
      [testAgent] = await ctx.db('rd_agents')
        .insert({
          tenant: ctx.tenantId,
          agent_name: 'Event Test Agent',
          hostname: 'EVENT-HOST',
          os_type: 'windows',
          agent_version: '0.1.0',
          status: 'online',
          connection_token: `${ctx.tenantId}:event-agent:${Date.now()}`
        })
        .returning('*');

      [testSession] = await ctx.db('rd_sessions')
        .insert({
          tenant: ctx.tenantId,
          agent_id: testAgent.agent_id,
          engineer_user_id: ctx.user.user_id,
          status: 'active'
        })
        .returning('*');
    });

    it('logs session events', async () => {
      // Log multiple events
      await ctx.db('rd_session_events').insert([
        {
          tenant: ctx.tenantId,
          session_id: testSession.session_id,
          event_type: 'session_requested',
          event_data: { user_id: ctx.user.user_id }
        },
        {
          tenant: ctx.tenantId,
          session_id: testSession.session_id,
          event_type: 'session_accepted',
          event_data: { agent_id: testAgent.agent_id }
        },
        {
          tenant: ctx.tenantId,
          session_id: testSession.session_id,
          event_type: 'connection_established',
          event_data: { quality: 'good' }
        }
      ]);

      const events = await ctx.db('rd_session_events')
        .where({ tenant: ctx.tenantId, session_id: testSession.session_id })
        .orderBy('timestamp', 'asc');

      expect(events).toHaveLength(3);
      expect(events[0].event_type).toBe('session_requested');
      expect(events[1].event_type).toBe('session_accepted');
      expect(events[2].event_type).toBe('connection_established');
    });

    it('retrieves session with events', async () => {
      // Log some events
      await ctx.db('rd_session_events').insert({
        tenant: ctx.tenantId,
        session_id: testSession.session_id,
        event_type: 'input_started',
        event_data: { type: 'mouse' }
      });

      // Query session with events
      const session = await ctx.db('rd_sessions')
        .where({ tenant: ctx.tenantId, session_id: testSession.session_id })
        .first();

      const events = await ctx.db('rd_session_events')
        .where({ tenant: ctx.tenantId, session_id: testSession.session_id });

      expect(session).toBeDefined();
      expect(events.length).toBeGreaterThanOrEqual(1);
    });

    it('cascades event deletion when session is deleted', async () => {
      // Log an event
      await ctx.db('rd_session_events').insert({
        tenant: ctx.tenantId,
        session_id: testSession.session_id,
        event_type: 'session_ended',
        event_data: { reason: 'test' }
      });

      // Delete the session
      await ctx.db('rd_sessions')
        .where({ tenant: ctx.tenantId, session_id: testSession.session_id })
        .delete();

      // Events should be deleted too
      const events = await ctx.db('rd_session_events')
        .where({ tenant: ctx.tenantId, session_id: testSession.session_id });

      expect(events).toHaveLength(0);
    });
  });

  describe('Data Integrity', () => {
    it('enforces unique connection token per tenant', async () => {
      const uniqueToken = `${ctx.tenantId}:unique-agent:${Date.now()}`;

      // First insert should succeed
      await ctx.db('rd_agents').insert({
        tenant: ctx.tenantId,
        agent_name: 'Unique Agent 1',
        hostname: 'UNIQUE-01',
        os_type: 'windows',
        agent_version: '0.1.0',
        status: 'offline',
        connection_token: uniqueToken
      });

      // Second insert with same token should fail
      await expect(
        ctx.db('rd_agents').insert({
          tenant: ctx.tenantId,
          agent_name: 'Unique Agent 2',
          hostname: 'UNIQUE-02',
          os_type: 'windows',
          agent_version: '0.1.0',
          status: 'offline',
          connection_token: uniqueToken
        })
      ).rejects.toThrow();
    });

    it('requires valid agent for session creation', async () => {
      const fakeAgentId = '00000000-0000-0000-0000-000000000000';

      await expect(
        ctx.db('rd_sessions').insert({
          tenant: ctx.tenantId,
          agent_id: fakeAgentId,
          engineer_user_id: ctx.user.user_id,
          status: 'pending'
        })
      ).rejects.toThrow();
    });
  });
});
