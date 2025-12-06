/**
 * WebRTC Signaling Server for Remote Desktop
 * Handles WebSocket connections for agents and engineers to establish WebRTC peer connections
 */

import { WebSocketServer, WebSocket, RawData } from 'ws';
import { IncomingMessage } from 'http';
import { Server as HttpServer } from 'http';
import { SignalingMessage, AuthenticatedWSConnection } from '@/types/remoteDesktop';
import { getConnection } from '@/lib/db/db';
import { runWithTenant } from '@/lib/db';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { findUserByIdForApi } from '@/lib/actions/user-actions/findUserByIdForApi';
import logger from '@alga-psa/shared/core/logger';

interface AuthenticatedWebSocket extends WebSocket {
  isAlive: boolean;
  userId?: string;
  sessionId?: string;
  tenant?: string;
  role?: 'agent' | 'engineer';
  agentId?: string;
}

export class SignalingServer {
  private wss: WebSocketServer;
  private clients: Map<string, AuthenticatedWebSocket> = new Map();
  private sessionToClients: Map<string, { agent?: string; engineer?: string }> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(options: { port?: number; server?: HttpServer; path?: string }) {
    const { port, server, path = '/ws/rd-signal' } = options;

    if (server) {
      this.wss = new WebSocketServer({
        server,
        path,
      });
    } else {
      this.wss = new WebSocketServer({
        port: port || 8080,
        path,
      });
    }

    this.setupServer();
  }

  private setupServer() {
    this.wss.on('connection', async (ws: AuthenticatedWebSocket, req: IncomingMessage) => {
      logger.info('New WebSocket connection attempt');

      try {
        // Extract auth token from query params or headers
        const url = new URL(req.url!, `http://${req.headers.host}`);
        const token = url.searchParams.get('token') || req.headers.authorization?.split(' ')[1];
        const role = url.searchParams.get('role') as 'agent' | 'engineer';

        if (!token) {
          logger.warn('WebSocket connection rejected: No token provided');
          ws.close(4001, 'Authentication required');
          return;
        }

        if (!role || (role !== 'agent' && role !== 'engineer')) {
          logger.warn('WebSocket connection rejected: Invalid role');
          ws.close(4002, 'Invalid role. Must be "agent" or "engineer"');
          return;
        }

        // Verify token and extract user info
        const authData = await this.authenticateConnection(token, role);
        if (!authData) {
          logger.warn('WebSocket connection rejected: Invalid token');
          ws.close(4001, 'Invalid token');
          return;
        }

        // Set up authenticated connection
        ws.isAlive = true;
        ws.userId = authData.userId;
        ws.tenant = authData.tenant;
        ws.role = role;

        if (role === 'agent') {
          ws.agentId = authData.agentId;
          this.clients.set(`agent:${authData.agentId}`, ws);

          // Update agent status to online
          await this.updateAgentStatus(authData.tenant, authData.agentId!, 'online');
        } else {
          this.clients.set(`engineer:${authData.userId}`, ws);
        }

        logger.info(`Authenticated ${role} connected: ${authData.userId}`);

        // Set up ping/pong for connection health
        ws.on('pong', () => {
          ws.isAlive = true;
        });

        // Handle incoming messages
        ws.on('message', async (data: RawData) => {
          await this.handleMessage(ws, data);
        });

        // Handle disconnection
        ws.on('close', async () => {
          await this.handleDisconnection(ws);
        });

        ws.on('error', (error) => {
          logger.error(`WebSocket error for ${role}:${ws.userId}:`, error);
        });

        // Send connection confirmation
        ws.send(JSON.stringify({
          type: 'connected',
          role,
          userId: authData.userId,
        }));

      } catch (error) {
        logger.error('Connection error:', error);
        ws.close(4000, 'Internal server error');
      }
    });

    // Set up heartbeat interval
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws: AuthenticatedWebSocket) => {
        if (ws.isAlive === false) {
          logger.debug(`Terminating inactive WebSocket for ${ws.role}:${ws.userId}`);
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // 30 seconds

    this.wss.on('close', () => {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }
    });

    logger.info(`WebSocket signaling server initialized`);
  }

  private async authenticateConnection(token: string, role: 'agent' | 'engineer'): Promise<{
    userId: string;
    tenant: string;
    agentId?: string;
  } | null> {
    try {
      // For agents, token is the connection_token from rd_agents table
      if (role === 'agent') {
        // Parse agent token (format: "tenant:agent_id:secret")
        const parts = token.split(':');
        if (parts.length < 3) {
          logger.warn('Invalid agent token format');
          return null;
        }

        const [tenant, agentId] = parts;
        // The full token is stored in connection_token

        return await runWithTenant(tenant, async () => {
          const knex = await getConnection(tenant);

          const agent = await knex('rd_agents')
            .where({ tenant, agent_id: agentId, connection_token: token })
            .first();

          if (!agent) {
            logger.warn(`Agent not found or invalid token for agent_id: ${agentId}`);
            return null;
          }

          if (agent.status === 'suspended') {
            logger.warn(`Agent ${agentId} is suspended`);
            return null;
          }

          return {
            userId: agentId,
            tenant,
            agentId,
          };
        });
      } else {
        // For engineers, verify API key or JWT token
        // Try API key validation first
        let keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(token);

        if (!keyRecord) {
          logger.warn('Invalid API key for engineer');
          return null;
        }

        // Get user within tenant context
        const user = await findUserByIdForApi(keyRecord.user_id, keyRecord.tenant);

        if (!user) {
          logger.warn(`User not found for API key: ${keyRecord.user_id}`);
          return null;
        }

        return {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
        };
      }
    } catch (error) {
      logger.error('Authentication error:', error);
      return null;
    }
  }

  private async handleMessage(ws: AuthenticatedWebSocket, data: RawData) {
    try {
      const message: SignalingMessage = JSON.parse(data.toString());
      logger.debug(`Received ${message.type} from ${ws.role}:${ws.userId}`);

      switch (message.type) {
        case 'offer':
        case 'answer':
        case 'ice-candidate':
          await this.routeSignalingMessage(ws, message);
          break;

        case 'session-request':
          await this.handleSessionRequest(ws, message);
          break;

        case 'session-accept':
          await this.handleSessionAccept(ws, message);
          break;

        case 'session-deny':
          await this.handleSessionDeny(ws, message);
          break;

        default:
          logger.warn(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      logger.error('Error handling message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to process message',
      }));
    }
  }

  private async routeSignalingMessage(sender: AuthenticatedWebSocket, message: SignalingMessage) {
    const sessionId = message.sessionId;

    if (!sessionId) {
      sender.send(JSON.stringify({
        type: 'error',
        message: 'Session ID required',
      }));
      return;
    }

    // Get the other peer in this session
    const sessionMapping = this.sessionToClients.get(sessionId);
    if (!sessionMapping) {
      sender.send(JSON.stringify({
        type: 'error',
        message: 'Session not found',
      }));
      return;
    }

    const targetKey = sender.role === 'agent'
      ? `engineer:${sessionMapping.engineer}`
      : `agent:${sessionMapping.agent}`;

    const target = this.clients.get(targetKey);

    if (!target || target.readyState !== WebSocket.OPEN) {
      sender.send(JSON.stringify({
        type: 'error',
        message: 'Peer not connected',
      }));
      return;
    }

    // Forward the message
    target.send(JSON.stringify(message));
  }

  private async handleSessionRequest(engineer: AuthenticatedWebSocket, message: SignalingMessage) {
    if (!engineer.tenant || !message.sessionId) {
      engineer.send(JSON.stringify({
        type: 'error',
        message: 'Invalid session request',
      }));
      return;
    }

    await runWithTenant(engineer.tenant, async () => {
      const knex = await getConnection(engineer.tenant!);

      const session = await knex('rd_sessions')
        .where({
          tenant: engineer.tenant,
          session_id: message.sessionId,
        })
        .first();

      if (!session) {
        engineer.send(JSON.stringify({
          type: 'error',
          message: 'Session not found',
        }));
        return;
      }

      // Register session mapping
      this.sessionToClients.set(message.sessionId!, {
        engineer: engineer.userId,
        agent: session.agent_id,
      });

      // Store session ID on engineer websocket
      engineer.sessionId = message.sessionId;

      // Forward request to agent
      const agent = this.clients.get(`agent:${session.agent_id}`);

      if (!agent || agent.readyState !== WebSocket.OPEN) {
        engineer.send(JSON.stringify({
          type: 'error',
          message: 'Agent not connected',
        }));

        // Update session status to failed
        await knex('rd_sessions')
          .where({ tenant: engineer.tenant, session_id: message.sessionId })
          .update({ status: 'failed', end_reason: 'agent_offline' });

        return;
      }

      agent.sessionId = message.sessionId;
      agent.send(JSON.stringify({
        type: 'session-request',
        sessionId: message.sessionId,
        engineerId: engineer.userId,
      }));
    });
  }

  private async handleSessionAccept(agent: AuthenticatedWebSocket, message: SignalingMessage) {
    if (!agent.tenant || !message.sessionId) {
      return;
    }

    await runWithTenant(agent.tenant, async () => {
      const knex = await getConnection(agent.tenant!);

      await knex('rd_sessions')
        .where({
          tenant: agent.tenant,
          session_id: message.sessionId,
        })
        .update({
          status: 'active',
          started_at: knex.fn.now(),
        });

      // Log event
      await knex('rd_session_events').insert({
        tenant: agent.tenant,
        session_id: message.sessionId,
        event_type: 'session_accepted',
        event_data: { agent_id: agent.agentId },
        timestamp: knex.fn.now(),
      });

      // Notify engineer
      const sessionMapping = this.sessionToClients.get(message.sessionId!);
      if (sessionMapping?.engineer) {
        const engineer = this.clients.get(`engineer:${sessionMapping.engineer}`);
        if (engineer && engineer.readyState === WebSocket.OPEN) {
          engineer.send(JSON.stringify({
            type: 'session-accept',
            sessionId: message.sessionId,
          }));
        }
      }
    });
  }

  private async handleSessionDeny(agent: AuthenticatedWebSocket, message: SignalingMessage) {
    if (!agent.tenant || !message.sessionId) {
      return;
    }

    await runWithTenant(agent.tenant, async () => {
      const knex = await getConnection(agent.tenant!);

      await knex('rd_sessions')
        .where({
          tenant: agent.tenant,
          session_id: message.sessionId,
        })
        .update({
          status: 'denied',
          ended_at: knex.fn.now(),
          end_reason: 'user_denied',
        });

      // Log event
      await knex('rd_session_events').insert({
        tenant: agent.tenant,
        session_id: message.sessionId,
        event_type: 'session_denied',
        event_data: { agent_id: agent.agentId },
        timestamp: knex.fn.now(),
      });

      // Notify engineer
      const sessionMapping = this.sessionToClients.get(message.sessionId!);
      if (sessionMapping?.engineer) {
        const engineer = this.clients.get(`engineer:${sessionMapping.engineer}`);
        if (engineer && engineer.readyState === WebSocket.OPEN) {
          engineer.send(JSON.stringify({
            type: 'session-deny',
            sessionId: message.sessionId,
          }));
        }
      }

      // Clean up session mapping
      this.sessionToClients.delete(message.sessionId!);
    });
  }

  private async handleDisconnection(ws: AuthenticatedWebSocket) {
    logger.info(`${ws.role}:${ws.userId} disconnected`);

    // Remove from clients map
    if (ws.role === 'agent' && ws.agentId) {
      this.clients.delete(`agent:${ws.agentId}`);

      // Update agent status to offline
      if (ws.tenant && ws.agentId) {
        await this.updateAgentStatus(ws.tenant, ws.agentId, 'offline');
      }
    } else if (ws.userId) {
      this.clients.delete(`engineer:${ws.userId}`);
    }

    // Clean up session mapping if exists
    if (ws.sessionId) {
      const sessionMapping = this.sessionToClients.get(ws.sessionId);

      // Notify the other party about disconnection
      if (sessionMapping) {
        const otherPartyKey = ws.role === 'agent'
          ? `engineer:${sessionMapping.engineer}`
          : `agent:${sessionMapping.agent}`;

        const otherParty = this.clients.get(otherPartyKey);
        if (otherParty && otherParty.readyState === WebSocket.OPEN) {
          otherParty.send(JSON.stringify({
            type: 'error',
            message: 'Peer disconnected',
            sessionId: ws.sessionId,
          }));
        }
      }

      this.sessionToClients.delete(ws.sessionId);
    }
  }

  private async updateAgentStatus(tenant: string, agentId: string, status: 'online' | 'offline') {
    try {
      await runWithTenant(tenant, async () => {
        const knex = await getConnection(tenant);

        await knex('rd_agents')
          .where({ tenant, agent_id: agentId })
          .update({
            status,
            last_seen_at: knex.fn.now(),
          });
      });
    } catch (error) {
      logger.error('Error updating agent status:', error);
    }
  }

  public getConnectedClients(): { agents: number; engineers: number } {
    let agents = 0;
    let engineers = 0;

    this.clients.forEach((_, key) => {
      if (key.startsWith('agent:')) {
        agents++;
      } else if (key.startsWith('engineer:')) {
        engineers++;
      }
    });

    return { agents, engineers };
  }

  public close() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.wss.close();
    logger.info('WebSocket signaling server closed');
  }
}
