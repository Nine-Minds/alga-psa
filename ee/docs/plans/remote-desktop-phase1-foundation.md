# Remote Desktop Support - Phase 1: Foundation
## Implementation Plan (Weeks 1-4)

**Status**: Planning
**Duration**: 4 weeks
**Owner**: Engineering Team
**Last Updated**: 2025-12-05

---

## Table of Contents

1. [Overview](#overview)
2. [Goals & Success Criteria](#goals--success-criteria)
3. [Technical Architecture](#technical-architecture)
4. [Week-by-Week Breakdown](#week-by-week-breakdown)
5. [Directory Structure](#directory-structure)
6. [Database Schema](#database-schema)
7. [API Endpoints](#api-endpoints)
8. [Testing Strategy](#testing-strategy)
9. [Dependencies & Risks](#dependencies--risks)

---

## Overview

Phase 1 establishes the core WebRTC infrastructure for remote desktop support. By the end of this phase, we will have a working proof-of-concept where an engineer can remotely view and control a Windows machine through the browser.

### What We're Building

- **Server**: WebSocket signaling server, session management APIs, database schema
- **Agent**: Windows-only desktop agent with screen capture and input injection (Rust)
- **Browser Client**: React component for viewing remote desktop and sending input

### What We're NOT Building (Yet)

- macOS agent (Phase 2)
- File transfer (Phase 2)
- Terminal access (Phase 2)
- Auto-update mechanism (Phase 3)
- Production deployment/packaging (Phase 3)
- Advanced features: clipboard, multi-monitor, audio (Phase 4)

---

## Goals & Success Criteria

### Primary Goals

1. ✅ **Functional WebRTC Connection**: Agent and browser can establish peer connection
2. ✅ **Screen Sharing Works**: Engineer sees remote desktop screen in real-time
3. ✅ **Input Control Works**: Engineer can control mouse and keyboard remotely
4. ✅ **Session Management**: Create, track, and terminate sessions via API

### Success Criteria

- [ ] Demo: Connect to a Windows VM and control it from browser
- [ ] Latency: <200ms round-trip for input events on local network
- [ ] Frame Rate: ≥15 FPS for desktop streaming
- [ ] All integration tests passing
- [ ] No TypeScript/Rust compilation errors
- [ ] Architecture supports adding macOS agent in Phase 2

### Non-Goals for Phase 1

- Production-ready packaging or installers
- Security hardening (RBAC, encryption at rest, audit logs)
- Performance optimization beyond basic functionality
- Multi-monitor support
- Advanced compression or adaptive bitrate

---

## Technical Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      ALGA PSA SERVER                            │
│                                                                  │
│  ┌──────────────────┐         ┌──────────────────────────────┐ │
│  │  WebSocket       │         │  REST API                     │ │
│  │  Signaling       │         │  /api/v1/remote-desktop/*     │ │
│  │  /ws/rd-signal   │         │                               │ │
│  └────────┬─────────┘         └────────┬─────────────────────┘ │
│           │                            │                        │
│           │         ┌──────────────────┴──────────┐            │
│           │         │  Session Manager            │            │
│           └────────►│  - Auth/Authorization       │            │
│                     │  - State Management         │            │
│                     │  - DB Persistence           │            │
│                     └─────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                           │                │
                WebSocket  │                │  HTTPS
                Signaling  │                │  API Calls
                           │                │
        ┌──────────────────┴────────┐      │
        │                            │      │
        ▼                            ▼      ▼
┌───────────────────┐        ┌──────────────────────────┐
│  AGENT (Rust)     │        │  BROWSER CLIENT (React)  │
│  - Windows only   │◄──────►│  - Desktop Viewer        │
│  - Screen capture │ WebRTC │  - Input Handler         │
│  - Input inject   │  P2P   │  - Session Controls      │
└───────────────────┘        └──────────────────────────┘
```

### Technology Stack

**Server**
- Node.js + Express (existing Alga PSA server)
- WebSocket library: `ws`
- Database: PostgreSQL (existing)
- Authentication: Existing Alga auth system

**Agent (Rust)**
- `webrtc-rs`: WebRTC implementation
- `scrap`: Screen capture (Windows)
- `enigo`: Input injection (mouse/keyboard)
- `tokio`: Async runtime
- `tungstenite`: WebSocket client

**Browser Client**
- React + TypeScript
- Native WebRTC APIs
- Component library: Existing Alga UI components

---

## Week-by-Week Breakdown

### Week 1: Foundation & Database

**Focus**: Set up project structure, database schema, and basic API scaffolding

#### Goals
- Database tables created and tested
- Project directories established
- Basic API endpoints returning mock data
- Development environment documented

#### Tasks

##### 1.1 Database Schema Setup

<details>
<summary><strong>Create migration for remote desktop tables</strong></summary>

**File**: `/Users/roberisaacs/alga-psa/.conductor/tirana/server/migrations/YYYYMMDDHHMMSS_create_remote_desktop_tables.cjs`

**Implementation**:

```javascript
exports.up = async function(knex) {
  // Remote desktop agents table
  await knex.schema.createTable('rd_agents', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('agent_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('agent_name').notNullable(); // User-friendly name
    table.text('hostname').notNullable();
    table.text('os_type').notNullable(); // 'windows', 'macos'
    table.text('os_version');
    table.uuid('company_id'); // Associated client company
    table.text('agent_version').notNullable();
    table.text('status').notNullable().defaultTo('offline'); // 'online', 'offline', 'suspended'
    table.timestamp('last_seen_at', { useTz: true });
    table.timestamp('registered_at', { useTz: true }).defaultTo(knex.fn.now());
    table.jsonb('metadata').defaultTo('{}'); // IP address, system info, etc.
    table.text('connection_token'); // Secure token for agent auth

    table.primary(['tenant', 'agent_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.index(['tenant', 'status']);
    table.index(['tenant', 'company_id']);
  });

  // Remote desktop sessions table
  await knex.schema.createTable('rd_sessions', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('session_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('agent_id').notNullable();
    table.uuid('engineer_user_id').notNullable(); // User initiating the session
    table.text('status').notNullable().defaultTo('pending');
    // Status: 'pending', 'active', 'ended', 'denied', 'failed'
    table.timestamp('requested_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('started_at', { useTz: true });
    table.timestamp('ended_at', { useTz: true });
    table.text('end_reason'); // 'user_disconnect', 'timeout', 'error', etc.
    table.jsonb('connection_metadata').defaultTo('{}'); // ICE candidates, connection quality
    table.integer('duration_seconds'); // Calculated on end

    table.primary(['tenant', 'session_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'agent_id']).references(['tenant', 'agent_id']).inTable('rd_agents');
    table.foreign(['tenant', 'engineer_user_id']).references(['tenant', 'user_id']).inTable('users');
    table.index(['tenant', 'status']);
    table.index(['tenant', 'agent_id']);
    table.index(['tenant', 'engineer_user_id']);
  });

  // Session events log (for audit trail)
  await knex.schema.createTable('rd_session_events', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('event_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('session_id').notNullable();
    table.text('event_type').notNullable();
    // 'connection_established', 'input_started', 'file_transfer', 'connection_lost', etc.
    table.jsonb('event_data').defaultTo('{}');
    table.timestamp('timestamp', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'event_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'session_id']).references(['tenant', 'session_id']).inTable('rd_sessions');
    table.index(['tenant', 'session_id', 'timestamp']);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('rd_session_events');
  await knex.schema.dropTableIfExists('rd_sessions');
  await knex.schema.dropTableIfExists('rd_agents');
};
```

**Success Criteria**:
- Migration runs without errors
- All foreign keys properly constrained
- Indexes created for common queries
- Can insert/query test data

**Testing**:
```bash
# Run migration
cd /Users/roberisaacs/alga-psa/.conductor/tirana/server
npx knex migrate:latest

# Verify tables created
psql -U app_user -d server -c "\dt rd_*"

# Test data insertion
psql -U app_user -d server -c "INSERT INTO rd_agents (tenant, agent_name, hostname, os_type, agent_version) VALUES ('default', 'Test Agent', 'WIN-TEST-01', 'windows', '0.1.0');"
```

</details>

##### 1.2 TypeScript Type Definitions

<details>
<summary><strong>Create shared types for remote desktop domain</strong></summary>

**File**: `/Users/roberisaacs/alga-psa/.conductor/tirana/server/src/types/remoteDesktop.ts`

**Implementation**:

```typescript
// Agent types
export type AgentStatus = 'online' | 'offline' | 'suspended';
export type OSType = 'windows' | 'macos';

export interface IRemoteAgent {
  tenant: string;
  agent_id: string;
  agent_name: string;
  hostname: string;
  os_type: OSType;
  os_version?: string;
  company_id?: string;
  agent_version: string;
  status: AgentStatus;
  last_seen_at?: Date;
  registered_at: Date;
  metadata: {
    ip_address?: string;
    cpu?: string;
    memory_gb?: number;
    [key: string]: unknown;
  };
  connection_token?: string;
}

// Session types
export type SessionStatus = 'pending' | 'active' | 'ended' | 'denied' | 'failed';
export type SessionEndReason =
  | 'user_disconnect'
  | 'timeout'
  | 'error'
  | 'agent_offline'
  | 'user_denied';

export interface IRemoteSession {
  tenant: string;
  session_id: string;
  agent_id: string;
  engineer_user_id: string;
  status: SessionStatus;
  requested_at: Date;
  started_at?: Date;
  ended_at?: Date;
  end_reason?: SessionEndReason;
  connection_metadata: {
    ice_candidates?: unknown[];
    connection_quality?: string;
    [key: string]: unknown;
  };
  duration_seconds?: number;
}

// Session event types
export type SessionEventType =
  | 'session_requested'
  | 'session_accepted'
  | 'session_denied'
  | 'connection_established'
  | 'connection_lost'
  | 'input_started'
  | 'input_stopped'
  | 'screenshot_taken'
  | 'session_ended';

export interface ISessionEvent {
  tenant: string;
  event_id: string;
  session_id: string;
  event_type: SessionEventType;
  event_data: Record<string, unknown>;
  timestamp: Date;
}

// WebSocket signaling message types
export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'session-request' | 'session-accept' | 'session-deny';
  sessionId: string;
  senderId: string;
  payload: unknown;
  timestamp: number;
}

export interface SDPMessage {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface ICECandidateMessage {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

// API request/response types
export interface CreateSessionRequest {
  agent_id: string;
}

export interface CreateSessionResponse {
  session_id: string;
  status: SessionStatus;
  agent_info: {
    agent_id: string;
    agent_name: string;
    hostname: string;
    os_type: OSType;
  };
}

export interface SessionDetailsResponse extends IRemoteSession {
  agent: IRemoteAgent;
  events: ISessionEvent[];
}
```

**Success Criteria**:
- No TypeScript compilation errors
- Types align with database schema
- Can import types in other files

</details>

##### 1.3 API Controller Scaffolding

<details>
<summary><strong>Create RemoteDesktopController with basic CRUD</strong></summary>

**File**: `/Users/roberisaacs/alga-psa/.conductor/tirana/server/src/lib/api/controllers/ApiRemoteDesktopController.ts`

**Implementation**:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { getKnexConfigWithTenant } from '@/lib/db/knexfile';
import Knex from 'knex';
import {
  IRemoteAgent,
  IRemoteSession,
  CreateSessionRequest,
  CreateSessionResponse,
  SessionDetailsResponse
} from '@/types/remoteDesktop';

export class ApiRemoteDesktopController extends ApiBaseController {

  /**
   * GET /api/v1/remote-desktop/agents
   * List all agents for the tenant
   */
  listAgents() {
    return async (request: NextRequest): Promise<NextResponse> => {
      try {
        const { user, tenant } = await this.authenticate(request);

        const knexConfig = await getKnexConfigWithTenant(tenant);
        const knex = Knex(knexConfig);

        try {
          const agents: IRemoteAgent[] = await knex('rd_agents')
            .where({ tenant })
            .orderBy('agent_name', 'asc')
            .select('*');

          return NextResponse.json({
            success: true,
            data: agents
          });
        } finally {
          await knex.destroy();
        }
      } catch (error) {
        return this.handleError(error);
      }
    };
  }

  /**
   * GET /api/v1/remote-desktop/agents/:agentId
   * Get details for a specific agent
   */
  getAgent() {
    return async (request: NextRequest, context: { params: { agentId: string } }): Promise<NextResponse> => {
      try {
        const { user, tenant } = await this.authenticate(request);
        const { agentId } = context.params;

        const knexConfig = await getKnexConfigWithTenant(tenant);
        const knex = Knex(knexConfig);

        try {
          const agent: IRemoteAgent | undefined = await knex('rd_agents')
            .where({ tenant, agent_id: agentId })
            .first();

          if (!agent) {
            return NextResponse.json(
              { success: false, error: 'Agent not found' },
              { status: 404 }
            );
          }

          return NextResponse.json({
            success: true,
            data: agent
          });
        } finally {
          await knex.destroy();
        }
      } catch (error) {
        return this.handleError(error);
      }
    };
  }

  /**
   * POST /api/v1/remote-desktop/sessions
   * Create a new remote desktop session
   */
  createSession() {
    return async (request: NextRequest): Promise<NextResponse> => {
      try {
        const { user, tenant } = await this.authenticate(request);
        const body: CreateSessionRequest = await request.json();

        const knexConfig = await getKnexConfigWithTenant(tenant);
        const knex = Knex(knexConfig);

        try {
          // Verify agent exists and is online
          const agent: IRemoteAgent | undefined = await knex('rd_agents')
            .where({ tenant, agent_id: body.agent_id })
            .first();

          if (!agent) {
            return NextResponse.json(
              { success: false, error: 'Agent not found' },
              { status: 404 }
            );
          }

          if (agent.status !== 'online') {
            return NextResponse.json(
              { success: false, error: 'Agent is not online' },
              { status: 400 }
            );
          }

          // Create session record
          const [session] = await knex('rd_sessions')
            .insert({
              tenant,
              agent_id: body.agent_id,
              engineer_user_id: user.user_id,
              status: 'pending',
              requested_at: knex.fn.now()
            })
            .returning('*');

          // Log session request event
          await knex('rd_session_events').insert({
            tenant,
            session_id: session.session_id,
            event_type: 'session_requested',
            event_data: { user_id: user.user_id },
            timestamp: knex.fn.now()
          });

          const response: CreateSessionResponse = {
            session_id: session.session_id,
            status: session.status,
            agent_info: {
              agent_id: agent.agent_id,
              agent_name: agent.agent_name,
              hostname: agent.hostname,
              os_type: agent.os_type
            }
          };

          return NextResponse.json({
            success: true,
            data: response
          }, { status: 201 });
        } finally {
          await knex.destroy();
        }
      } catch (error) {
        return this.handleError(error);
      }
    };
  }

  /**
   * GET /api/v1/remote-desktop/sessions/:sessionId
   * Get session details including events
   */
  getSession() {
    return async (request: NextRequest, context: { params: { sessionId: string } }): Promise<NextResponse> => {
      try {
        const { user, tenant } = await this.authenticate(request);
        const { sessionId } = context.params;

        const knexConfig = await getKnexConfigWithTenant(tenant);
        const knex = Knex(knexConfig);

        try {
          const session: IRemoteSession | undefined = await knex('rd_sessions')
            .where({ tenant, session_id: sessionId })
            .first();

          if (!session) {
            return NextResponse.json(
              { success: false, error: 'Session not found' },
              { status: 404 }
            );
          }

          // Get agent details
          const agent: IRemoteAgent = await knex('rd_agents')
            .where({ tenant, agent_id: session.agent_id })
            .first();

          // Get session events
          const events = await knex('rd_session_events')
            .where({ tenant, session_id: sessionId })
            .orderBy('timestamp', 'asc');

          const response: SessionDetailsResponse = {
            ...session,
            agent,
            events
          };

          return NextResponse.json({
            success: true,
            data: response
          });
        } finally {
          await knex.destroy();
        }
      } catch (error) {
        return this.handleError(error);
      }
    };
  }

  /**
   * DELETE /api/v1/remote-desktop/sessions/:sessionId
   * End an active session
   */
  endSession() {
    return async (request: NextRequest, context: { params: { sessionId: string } }): Promise<NextResponse> => {
      try {
        const { user, tenant } = await this.authenticate(request);
        const { sessionId } = context.params;

        const knexConfig = await getKnexConfigWithTenant(tenant);
        const knex = Knex(knexConfig);

        try {
          const session: IRemoteSession | undefined = await knex('rd_sessions')
            .where({ tenant, session_id: sessionId })
            .first();

          if (!session) {
            return NextResponse.json(
              { success: false, error: 'Session not found' },
              { status: 404 }
            );
          }

          if (session.status === 'ended') {
            return NextResponse.json(
              { success: false, error: 'Session already ended' },
              { status: 400 }
            );
          }

          // Calculate duration if session was active
          const now = new Date();
          const duration = session.started_at
            ? Math.floor((now.getTime() - new Date(session.started_at).getTime()) / 1000)
            : 0;

          // Update session
          await knex('rd_sessions')
            .where({ tenant, session_id: sessionId })
            .update({
              status: 'ended',
              ended_at: knex.fn.now(),
              end_reason: 'user_disconnect',
              duration_seconds: duration
            });

          // Log event
          await knex('rd_session_events').insert({
            tenant,
            session_id: sessionId,
            event_type: 'session_ended',
            event_data: { user_id: user.user_id, reason: 'user_disconnect' },
            timestamp: knex.fn.now()
          });

          return NextResponse.json({
            success: true,
            message: 'Session ended successfully'
          });
        } finally {
          await knex.destroy();
        }
      } catch (error) {
        return this.handleError(error);
      }
    };
  }

  /**
   * GET /api/v1/remote-desktop/sessions
   * List sessions for the tenant (with optional filters)
   */
  listSessions() {
    return async (request: NextRequest): Promise<NextResponse> => {
      try {
        const { user, tenant } = await this.authenticate(request);
        const { searchParams } = new URL(request.url);

        const agentId = searchParams.get('agent_id');
        const status = searchParams.get('status');

        const knexConfig = await getKnexConfigWithTenant(tenant);
        const knex = Knex(knexConfig);

        try {
          let query = knex('rd_sessions')
            .where({ tenant });

          if (agentId) {
            query = query.where({ agent_id: agentId });
          }

          if (status) {
            query = query.where({ status });
          }

          const sessions = await query
            .orderBy('requested_at', 'desc')
            .select('*');

          return NextResponse.json({
            success: true,
            data: sessions
          });
        } finally {
          await knex.destroy();
        }
      } catch (error) {
        return this.handleError(error);
      }
    };
  }
}
```

**Success Criteria**:
- Controller compiles without errors
- Extends ApiBaseController properly
- All methods have proper type signatures
- Error handling in place

</details>

##### 1.4 API Route Registration

<details>
<summary><strong>Register API routes in Next.js app directory</strong></summary>

**Files to create**:

1. `/Users/roberisaacs/alga-psa/.conductor/tirana/server/src/app/api/v1/remote-desktop/agents/route.ts`
```typescript
import { ApiRemoteDesktopController } from '@/lib/api/controllers/ApiRemoteDesktopController';

const controller = new ApiRemoteDesktopController();

export const GET = controller.listAgents();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
```

2. `/Users/roberisaacs/alga-psa/.conductor/tirana/server/src/app/api/v1/remote-desktop/agents/[agentId]/route.ts`
```typescript
import { ApiRemoteDesktopController } from '@/lib/api/controllers/ApiRemoteDesktopController';

const controller = new ApiRemoteDesktopController();

export const GET = controller.getAgent();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
```

3. `/Users/roberisaacs/alga-psa/.conductor/tirana/server/src/app/api/v1/remote-desktop/sessions/route.ts`
```typescript
import { ApiRemoteDesktopController } from '@/lib/api/controllers/ApiRemoteDesktopController';

const controller = new ApiRemoteDesktopController();

export const GET = controller.listSessions();
export const POST = controller.createSession();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
```

4. `/Users/roberisaacs/alga-psa/.conductor/tirana/server/src/app/api/v1/remote-desktop/sessions/[sessionId]/route.ts`
```typescript
import { ApiRemoteDesktopController } from '@/lib/api/controllers/ApiRemoteDesktopController';

const controller = new ApiRemoteDesktopController();

export const GET = controller.getSession();
export const DELETE = controller.endSession();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
```

**Success Criteria**:
- All routes accessible at expected URLs
- Routes return 401 without authentication
- Routes return proper JSON responses

**Testing**:
```bash
# Start dev server
cd /Users/roberisaacs/alga-psa/.conductor/tirana/server
npm run dev

# Test endpoints (with proper auth token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/remote-desktop/agents
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/remote-desktop/sessions
```

</details>

##### 1.5 Documentation

<details>
<summary><strong>Create development setup guide</strong></summary>

**File**: `/Users/roberisaacs/alga-psa/.conductor/tirana/ee/docs/dev-environment/remote-desktop-setup.md`

**Content**: Document how to:
- Set up local database with migrations
- Install Rust toolchain for agent development
- Configure WebSocket endpoints
- Run integration tests
- Common troubleshooting steps

**Success Criteria**:
- New developer can set up environment in <30 minutes
- All dependencies listed with versions
- Links to external documentation

</details>

**Week 1 Checklist**:
- [ ] Database migration created and tested
- [ ] TypeScript types defined
- [ ] API controller implemented
- [ ] API routes registered
- [ ] All endpoints return 200/201/404 appropriately
- [ ] Development guide written
- [ ] Code compiles without errors

---

### Week 2: WebSocket Signaling Server

**Focus**: Implement real-time WebSocket signaling for WebRTC connection establishment

#### Goals
- WebSocket server running on separate port
- Agents and browsers can connect via WebSocket
- Signaling messages routed between peers
- Basic authentication and session routing

#### Tasks

##### 2.1 WebSocket Server Implementation

<details>
<summary><strong>Create WebSocket signaling server</strong></summary>

**File**: `/Users/roberisaacs/alga-psa/.conductor/tirana/server/src/lib/remoteDesktop/SignalingServer.ts`

**Implementation**:

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { SignalingMessage } from '@/types/remoteDesktop';
import { verifyToken } from '@/lib/auth';
import Knex from 'knex';
import { getKnexConfigWithTenant } from '@/lib/db/knexfile';

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

  constructor(port: number = 8080) {
    this.wss = new WebSocketServer({
      port,
      path: '/ws/rd-signal'
    });

    this.setupServer();
  }

  private setupServer() {
    this.wss.on('connection', async (ws: AuthenticatedWebSocket, req: IncomingMessage) => {
      console.log('New WebSocket connection attempt');

      try {
        // Extract auth token from query params or headers
        const url = new URL(req.url!, `http://${req.headers.host}`);
        const token = url.searchParams.get('token') || req.headers.authorization?.split(' ')[1];
        const role = url.searchParams.get('role') as 'agent' | 'engineer';

        if (!token) {
          ws.close(4001, 'Authentication required');
          return;
        }

        // Verify token and extract user info
        const authData = await this.authenticateConnection(token, role);
        if (!authData) {
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
          await this.updateAgentStatus(authData.tenant, authData.agentId, 'online');
        } else {
          this.clients.set(`engineer:${authData.userId}`, ws);
        }

        console.log(`Authenticated ${role} connected: ${authData.userId}`);

        // Set up ping/pong for connection health
        ws.on('pong', () => {
          ws.isAlive = true;
        });

        // Handle incoming messages
        ws.on('message', async (data: Buffer) => {
          await this.handleMessage(ws, data);
        });

        // Handle disconnection
        ws.on('close', async () => {
          await this.handleDisconnection(ws);
        });

        // Send connection confirmation
        ws.send(JSON.stringify({
          type: 'connected',
          role,
          userId: authData.userId
        }));

      } catch (error) {
        console.error('Connection error:', error);
        ws.close(4000, 'Internal server error');
      }
    });

    // Set up heartbeat interval
    const interval = setInterval(() => {
      this.wss.clients.forEach((ws: AuthenticatedWebSocket) => {
        if (ws.isAlive === false) {
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // 30 seconds

    this.wss.on('close', () => {
      clearInterval(interval);
    });

    console.log(`WebSocket signaling server running on port ${port}`);
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
        const [tenant, agentId, secret] = token.split(':');

        const knexConfig = await getKnexConfigWithTenant(tenant);
        const knex = Knex(knexConfig);

        try {
          const agent = await knex('rd_agents')
            .where({ tenant, agent_id: agentId, connection_token: token })
            .first();

          if (!agent) {
            return null;
          }

          return {
            userId: agentId,
            tenant,
            agentId
          };
        } finally {
          await knex.destroy();
        }
      } else {
        // For engineers, verify JWT token
        const decoded = await verifyToken(token);
        return {
          userId: decoded.user_id,
          tenant: decoded.tenant
        };
      }
    } catch (error) {
      console.error('Authentication error:', error);
      return null;
    }
  }

  private async handleMessage(ws: AuthenticatedWebSocket, data: Buffer) {
    try {
      const message: SignalingMessage = JSON.parse(data.toString());
      console.log(`Received ${message.type} from ${ws.role}:${ws.userId}`);

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
          console.warn(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('Error handling message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to process message'
      }));
    }
  }

  private async routeSignalingMessage(sender: AuthenticatedWebSocket, message: SignalingMessage) {
    const sessionId = message.sessionId;

    // Get the other peer in this session
    const targetKey = sender.role === 'agent'
      ? `engineer:${this.sessionToClients.get(sessionId)?.engineer}`
      : `agent:${this.sessionToClients.get(sessionId)?.agent}`;

    const target = this.clients.get(targetKey);

    if (!target || target.readyState !== WebSocket.OPEN) {
      sender.send(JSON.stringify({
        type: 'error',
        message: 'Peer not connected'
      }));
      return;
    }

    // Forward the message
    target.send(JSON.stringify(message));
  }

  private async handleSessionRequest(engineer: AuthenticatedWebSocket, message: SignalingMessage) {
    // Extract agent_id from session in database
    const knexConfig = await getKnexConfigWithTenant(engineer.tenant!);
    const knex = Knex(knexConfig);

    try {
      const session = await knex('rd_sessions')
        .where({
          tenant: engineer.tenant,
          session_id: message.sessionId
        })
        .first();

      if (!session) {
        engineer.send(JSON.stringify({
          type: 'error',
          message: 'Session not found'
        }));
        return;
      }

      // Register session mapping
      this.sessionToClients.set(message.sessionId, {
        engineer: engineer.userId,
        agent: session.agent_id
      });

      // Store session ID on engineer websocket
      engineer.sessionId = message.sessionId;

      // Forward request to agent
      const agent = this.clients.get(`agent:${session.agent_id}`);

      if (!agent || agent.readyState !== WebSocket.OPEN) {
        engineer.send(JSON.stringify({
          type: 'error',
          message: 'Agent not connected'
        }));
        return;
      }

      agent.sessionId = message.sessionId;
      agent.send(JSON.stringify({
        type: 'session-request',
        sessionId: message.sessionId,
        engineerId: engineer.userId
      }));

    } finally {
      await knex.destroy();
    }
  }

  private async handleSessionAccept(agent: AuthenticatedWebSocket, message: SignalingMessage) {
    // Update session status to active
    const knexConfig = await getKnexConfigWithTenant(agent.tenant!);
    const knex = Knex(knexConfig);

    try {
      await knex('rd_sessions')
        .where({
          tenant: agent.tenant,
          session_id: message.sessionId
        })
        .update({
          status: 'active',
          started_at: knex.fn.now()
        });

      // Notify engineer
      const sessionMapping = this.sessionToClients.get(message.sessionId);
      if (sessionMapping?.engineer) {
        const engineer = this.clients.get(`engineer:${sessionMapping.engineer}`);
        if (engineer && engineer.readyState === WebSocket.OPEN) {
          engineer.send(JSON.stringify({
            type: 'session-accept',
            sessionId: message.sessionId
          }));
        }
      }
    } finally {
      await knex.destroy();
    }
  }

  private async handleSessionDeny(agent: AuthenticatedWebSocket, message: SignalingMessage) {
    // Update session status to denied
    const knexConfig = await getKnexConfigWithTenant(agent.tenant!);
    const knex = Knex(knexConfig);

    try {
      await knex('rd_sessions')
        .where({
          tenant: agent.tenant,
          session_id: message.sessionId
        })
        .update({
          status: 'denied',
          ended_at: knex.fn.now(),
          end_reason: 'user_denied'
        });

      // Notify engineer
      const sessionMapping = this.sessionToClients.get(message.sessionId);
      if (sessionMapping?.engineer) {
        const engineer = this.clients.get(`engineer:${sessionMapping.engineer}`);
        if (engineer && engineer.readyState === WebSocket.OPEN) {
          engineer.send(JSON.stringify({
            type: 'session-deny',
            sessionId: message.sessionId
          }));
        }
      }
    } finally {
      await knex.destroy();
    }
  }

  private async handleDisconnection(ws: AuthenticatedWebSocket) {
    console.log(`${ws.role}:${ws.userId} disconnected`);

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
      this.sessionToClients.delete(ws.sessionId);
    }
  }

  private async updateAgentStatus(tenant: string, agentId: string, status: 'online' | 'offline') {
    try {
      const knexConfig = await getKnexConfigWithTenant(tenant);
      const knex = Knex(knexConfig);

      try {
        await knex('rd_agents')
          .where({ tenant, agent_id: agentId })
          .update({
            status,
            last_seen_at: knex.fn.now()
          });
      } finally {
        await knex.destroy();
      }
    } catch (error) {
      console.error('Error updating agent status:', error);
    }
  }

  public close() {
    this.wss.close();
  }
}
```

**Success Criteria**:
- WebSocket server starts without errors
- Clients can connect with valid token
- Invalid tokens are rejected with 4001 code
- Heartbeat keeps connections alive
- Agent status updates on connect/disconnect

</details>

##### 2.2 Server Entry Point

<details>
<summary><strong>Start signaling server alongside Express/Next.js</strong></summary>

**File**: `/Users/roberisaacs/alga-psa/.conductor/tirana/server/src/lib/remoteDesktop/index.ts`

**Implementation**:

```typescript
import { SignalingServer } from './SignalingServer';

let signalingServer: SignalingServer | null = null;

export function startSignalingServer(port: number = 8080): SignalingServer {
  if (signalingServer) {
    console.log('Signaling server already running');
    return signalingServer;
  }

  signalingServer = new SignalingServer(port);
  return signalingServer;
}

export function stopSignalingServer() {
  if (signalingServer) {
    signalingServer.close();
    signalingServer = null;
  }
}
```

**File**: `/Users/roberisaacs/alga-psa/.conductor/tirana/server/index.ts` (modify existing)

Add to server startup:

```typescript
import { startSignalingServer } from './src/lib/remoteDesktop';

// After Express server starts
const WS_PORT = parseInt(process.env.WS_SIGNALING_PORT || '8080', 10);
startSignalingServer(WS_PORT);
console.log(`Remote Desktop signaling server started on port ${WS_PORT}`);
```

**Environment Variable**: Add to `.env`
```
WS_SIGNALING_PORT=8080
```

**Success Criteria**:
- Server starts on configured port
- Can see "WebSocket signaling server running" in logs
- Port is accessible (not blocked by firewall)

</details>

##### 2.3 WebSocket Client Test Utility

<details>
<summary><strong>Create test script for WebSocket connection</strong></summary>

**File**: `/Users/roberisaacs/alga-psa/.conductor/tirana/server/src/test/helpers/wsTestClient.ts`

**Implementation**:

```typescript
import WebSocket from 'ws';

export class TestWSClient {
  private ws: WebSocket | null = null;

  async connect(token: string, role: 'agent' | 'engineer'): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `ws://localhost:8080/ws/rd-signal?token=${token}&role=${role}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        console.log(`Connected as ${role}`);
        resolve();
      });

      this.ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      });

      this.ws.on('message', (data) => {
        console.log('Received:', data.toString());
      });
    });
  }

  send(message: object): void {
    if (!this.ws) {
      throw new Error('Not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Example usage test
async function testConnection() {
  const client = new TestWSClient();

  try {
    // Replace with actual token from your auth system
    const token = 'test-token-here';
    await client.connect(token, 'engineer');

    console.log('Connection successful!');

    client.close();
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run if executed directly
if (require.main === module) {
  testConnection();
}
```

**Success Criteria**:
- Script can connect to WebSocket server
- Receives connection confirmation
- Can send and receive messages
- Handles disconnection gracefully

**Testing**:
```bash
cd /Users/roberisaacs/alga-psa/.conductor/tirana/server
tsx src/test/helpers/wsTestClient.ts
```

</details>

**Week 2 Checklist**:
- [ ] SignalingServer class implemented
- [ ] WebSocket server integrated with main server
- [ ] Authentication working for both agents and engineers
- [ ] Message routing between peers functional
- [ ] Heartbeat mechanism working
- [ ] Agent status updates on connect/disconnect
- [ ] Test client can connect and send messages
- [ ] No memory leaks (test with multiple connections)

---

### Week 3: Windows Agent (Rust)

**Focus**: Build the Windows desktop agent with screen capture and input injection

#### Goals
- Rust agent project set up
- Agent can connect to signaling server
- Basic screen capture working
- Mouse/keyboard input injection functional
- WebRTC peer connection established

#### Tasks

##### 3.1 Rust Project Setup

<details>
<summary><strong>Initialize Rust workspace for remote desktop agent</strong></summary>

**Directory**: `/Users/roberisaacs/alga-psa/.conductor/tirana/ee/remote-desktop-agent/`

**Commands**:
```bash
cd /Users/roberisaacs/alga-psa/.conductor/tirana/ee
mkdir remote-desktop-agent
cd remote-desktop-agent
cargo init --name rd-agent
```

**File**: `/Users/roberisaacs/alga-psa/.conductor/tirana/ee/remote-desktop-agent/Cargo.toml`

```toml
[package]
name = "rd-agent"
version = "0.1.0"
edition = "2021"

[dependencies]
# WebRTC
webrtc = "0.9"

# WebSocket client
tokio-tungstenite = "0.21"
tungstenite = "0.21"

# Async runtime
tokio = { version = "1.35", features = ["full"] }
futures = "0.3"

# Screen capture
scrap = "0.5"

# Input injection
enigo = "0.2"

# Serialization
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

# Logging
log = "0.4"
env_logger = "0.11"

# Error handling
anyhow = "1.0"
thiserror = "1.0"

# Configuration
config = "0.14"

# UUID generation
uuid = { version = "1.6", features = ["v4", "serde"] }

[target.'cfg(windows)'.dependencies]
windows = { version = "0.52", features = [
    "Win32_Foundation",
    "Win32_System_Threading",
    "Win32_UI_Input_KeyboardAndMouse",
    "Win32_UI_WindowsAndMessaging",
] }
```

**Success Criteria**:
- `cargo build` compiles successfully
- All dependencies resolve
- No platform-specific errors on Windows

</details>

##### 3.2 Configuration System

<details>
<summary><strong>Create agent configuration file and loader</strong></summary>

**File**: `/Users/roberisaacs/alga-psa/.conductor/tirana/ee/remote-desktop-agent/config.toml`

```toml
[agent]
agent_id = ""  # Set during registration
agent_name = ""  # Set during registration
connection_token = ""  # Set during registration

[server]
signaling_url = "ws://localhost:8080/ws/rd-signal"
api_url = "http://localhost:3000/api/v1/remote-desktop"

[capture]
fps = 15
quality = 75  # JPEG quality 0-100

[network]
stun_servers = [
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302"
]
```

**File**: `/Users/roberisaacs/alga-psa/.conductor/tirana/ee/remote-desktop-agent/src/config.rs`

```rust
use serde::{Deserialize, Serialize};
use anyhow::Result;
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub agent: AgentConfig,
    pub server: ServerConfig,
    pub capture: CaptureConfig,
    pub network: NetworkConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub agent_id: String,
    pub agent_name: String,
    pub connection_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub signaling_url: String,
    pub api_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureConfig {
    pub fps: u32,
    pub quality: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkConfig {
    pub stun_servers: Vec<String>,
}

impl Config {
    pub fn load() -> Result<Self> {
        let config_str = fs::read_to_string("config.toml")?;
        let config: Config = toml::from_str(&config_str)?;
        Ok(config)
    }
}
```

**Success Criteria**:
- Config file loads without errors
- Can access all configuration values
- Missing config file produces helpful error

</details>

##### 3.3 Screen Capture Module

<details>
<summary><strong>Implement screen capture using scrap crate</strong></summary>

**File**: `/Users/roberisaacs/alga-psa/.conductor/tirana/ee/remote-desktop-agent/src/capture.rs`

```rust
use scrap::{Capturer, Display};
use std::time::Duration;
use anyhow::{Result, Context};
use log::{info, error, debug};

pub struct ScreenCapturer {
    capturer: Capturer,
    width: usize,
    height: usize,
}

impl ScreenCapturer {
    pub fn new() -> Result<Self> {
        // Get the primary display
        let display = Display::primary()
            .context("Failed to get primary display")?;

        let width = display.width();
        let height = display.height();

        info!("Initializing screen capturer for display {}x{}", width, height);

        let capturer = Capturer::new(display)
            .context("Failed to create capturer")?;

        Ok(ScreenCapturer {
            capturer,
            width,
            height,
        })
    }

    pub fn capture_frame(&mut self) -> Result<Vec<u8>> {
        // Capture the frame
        let frame = match self.capturer.frame() {
            Ok(frame) => frame,
            Err(e) => {
                if e.kind() == std::io::ErrorKind::WouldBlock {
                    // Frame not ready yet
                    debug!("Frame not ready, skipping");
                    return Ok(Vec::new());
                }
                return Err(anyhow::anyhow!("Failed to capture frame: {}", e));
            }
        };

        // Convert BGRA to RGB
        let mut rgb_data = Vec::with_capacity(self.width * self.height * 3);

        for chunk in frame.chunks(4) {
            rgb_data.push(chunk[2]); // R
            rgb_data.push(chunk[1]); // G
            rgb_data.push(chunk[0]); // B
        }

        Ok(rgb_data)
    }

    pub fn dimensions(&self) -> (usize, usize) {
        (self.width, self.height)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_capturer_creation() {
        let result = ScreenCapturer::new();
        assert!(result.is_ok());
    }

    #[test]
    fn test_capture_frame() {
        let mut capturer = ScreenCapturer::new().unwrap();
        let frame = capturer.capture_frame();
        assert!(frame.is_ok());
    }
}
```

**Success Criteria**:
- Can initialize screen capturer
- Captures frames at target FPS
- RGB conversion works correctly
- No memory leaks during continuous capture

**Testing**:
```bash
cd /Users/roberisaacs/alga-psa/.conductor/tirana/ee/remote-desktop-agent
cargo test --test capture
```

</details>

##### 3.4 Input Injection Module

<details>
<summary><strong>Implement mouse and keyboard control using enigo</strong></summary>

**File**: `/Users/roberisaacs/alga-psa/.conductor/tirana/ee/remote-desktop-agent/src/input.rs`

```rust
use enigo::{Enigo, MouseControllable, KeyboardControllable, MouseButton, Key};
use serde::{Deserialize, Serialize};
use anyhow::Result;
use log::debug;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum InputEvent {
    MouseMove { x: i32, y: i32 },
    MouseDown { button: String },
    MouseUp { button: String },
    MouseScroll { delta_x: i32, delta_y: i32 },
    KeyDown { key: String },
    KeyUp { key: String },
}

pub struct InputController {
    enigo: Enigo,
}

impl InputController {
    pub fn new() -> Self {
        InputController {
            enigo: Enigo::new(),
        }
    }

    pub fn handle_event(&mut self, event: InputEvent) -> Result<()> {
        debug!("Handling input event: {:?}", event);

        match event {
            InputEvent::MouseMove { x, y } => {
                self.enigo.mouse_move_to(x, y);
            }
            InputEvent::MouseDown { button } => {
                let mouse_btn = self.parse_mouse_button(&button)?;
                self.enigo.mouse_down(mouse_btn);
            }
            InputEvent::MouseUp { button } => {
                let mouse_btn = self.parse_mouse_button(&button)?;
                self.enigo.mouse_up(mouse_btn);
            }
            InputEvent::MouseScroll { delta_x: _, delta_y } => {
                // Note: enigo only supports vertical scroll
                self.enigo.mouse_scroll_y(delta_y);
            }
            InputEvent::KeyDown { key } => {
                let key_code = self.parse_key(&key)?;
                self.enigo.key_down(key_code);
            }
            InputEvent::KeyUp { key } => {
                let key_code = self.parse_key(&key)?;
                self.enigo.key_up(key_code);
            }
        }

        Ok(())
    }

    fn parse_mouse_button(&self, button: &str) -> Result<MouseButton> {
        match button {
            "left" => Ok(MouseButton::Left),
            "right" => Ok(MouseButton::Right),
            "middle" => Ok(MouseButton::Middle),
            _ => Err(anyhow::anyhow!("Unknown mouse button: {}", button)),
        }
    }

    fn parse_key(&self, key: &str) -> Result<Key> {
        // Map common keys - extend this as needed
        match key {
            "Enter" => Ok(Key::Return),
            "Backspace" => Ok(Key::Backspace),
            "Tab" => Ok(Key::Tab),
            "Escape" => Ok(Key::Escape),
            "Space" => Ok(Key::Space),
            "ArrowLeft" => Ok(Key::LeftArrow),
            "ArrowRight" => Ok(Key::RightArrow),
            "ArrowUp" => Ok(Key::UpArrow),
            "ArrowDown" => Ok(Key::DownArrow),
            "Control" => Ok(Key::Control),
            "Shift" => Ok(Key::Shift),
            "Alt" => Ok(Key::Alt),
            // Single character keys
            s if s.len() == 1 => {
                Ok(Key::Layout(s.chars().next().unwrap()))
            }
            _ => Err(anyhow::anyhow!("Unknown key: {}", key)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_input_controller_creation() {
        let _controller = InputController::new();
    }

    #[test]
    fn test_parse_mouse_button() {
        let controller = InputController::new();
        assert!(controller.parse_mouse_button("left").is_ok());
        assert!(controller.parse_mouse_button("right").is_ok());
        assert!(controller.parse_mouse_button("invalid").is_err());
    }

    #[test]
    fn test_parse_key() {
        let controller = InputController::new();
        assert!(controller.parse_key("Enter").is_ok());
        assert!(controller.parse_key("a").is_ok());
    }
}
```

**Success Criteria**:
- Mouse moves to correct coordinates
- Mouse clicks work (left, right, middle)
- Keyboard input types correctly
- Special keys (arrows, modifiers) work

**Testing**: Manual testing with test UI (created in Week 4)

</details>

##### 3.5 WebSocket Client

<details>
<summary><strong>Connect agent to signaling server</strong></summary>

**File**: `/Users/roberisaacs/alga-psa/.conductor/tirana/ee/remote-desktop-agent/src/signaling.rs`

```rust
use tokio_tungstenite::{connect_async, tungstenite::Message};
use futures::{StreamExt, SinkExt};
use serde::{Deserialize, Serialize};
use anyhow::Result;
use log::{info, error, debug};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalingMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "senderId")]
    pub sender_id: String,
    pub payload: serde_json::Value,
    pub timestamp: u64,
}

pub struct SignalingClient {
    ws_url: String,
    connection_token: String,
}

impl SignalingClient {
    pub fn new(ws_url: String, connection_token: String) -> Self {
        SignalingClient {
            ws_url,
            connection_token,
        }
    }

    pub async fn connect(&self) -> Result<()> {
        let url = format!("{}?token={}&role=agent", self.ws_url, self.connection_token);

        info!("Connecting to signaling server: {}", url);

        let (ws_stream, _) = connect_async(&url).await?;
        info!("WebSocket connection established");

        let (mut write, mut read) = ws_stream.split();

        // Handle incoming messages
        while let Some(message) = read.next().await {
            match message {
                Ok(Message::Text(text)) => {
                    debug!("Received: {}", text);
                    self.handle_message(&text)?;
                }
                Ok(Message::Close(_)) => {
                    info!("Connection closed");
                    break;
                }
                Err(e) => {
                    error!("WebSocket error: {}", e);
                    return Err(e.into());
                }
                _ => {}
            }
        }

        Ok(())
    }

    fn handle_message(&self, message: &str) -> Result<()> {
        let msg: SignalingMessage = serde_json::from_str(message)?;

        match msg.msg_type.as_str() {
            "connected" => {
                info!("Successfully connected to signaling server");
            }
            "session-request" => {
                info!("Received session request: {}", msg.session_id);
                // TODO: Show user consent dialog
            }
            "offer" => {
                info!("Received WebRTC offer");
                // TODO: Handle WebRTC offer
            }
            "ice-candidate" => {
                debug!("Received ICE candidate");
                // TODO: Add ICE candidate to peer connection
            }
            _ => {
                debug!("Unknown message type: {}", msg.msg_type);
            }
        }

        Ok(())
    }

    pub async fn send_message(&self, message: SignalingMessage) -> Result<()> {
        let json = serde_json::to_string(&message)?;
        // TODO: Send via WebSocket (need to store write half)
        Ok(())
    }
}
```

**Success Criteria**:
- Agent connects to signaling server
- Receives connection confirmation
- Can parse incoming messages
- Connection stays alive with heartbeat

</details>

##### 3.6 Main Agent Loop

<details>
<summary><strong>Implement main agent entry point</strong></summary>

**File**: `/Users/roberisaacs/alga-psa/.conductor/tirana/ee/remote-desktop-agent/src/main.rs`

```rust
mod config;
mod capture;
mod input;
mod signaling;

use anyhow::Result;
use log::{info, error};
use tokio;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logger
    env_logger::init();

    info!("Starting Remote Desktop Agent v{}", env!("CARGO_PKG_VERSION"));

    // Load configuration
    let config = config::Config::load()?;
    info!("Configuration loaded");

    // Initialize modules
    let mut capturer = capture::ScreenCapturer::new()?;
    let mut input_controller = input::InputController::new();
    let signaling_client = signaling::SignalingClient::new(
        config.server.signaling_url.clone(),
        config.agent.connection_token.clone(),
    );

    // Test screen capture
    info!("Testing screen capture...");
    let frame = capturer.capture_frame()?;
    info!("Captured frame: {} bytes", frame.len());

    // Connect to signaling server
    info!("Connecting to signaling server...");
    signaling_client.connect().await?;

    info!("Agent started successfully");

    // TODO: Main event loop for WebRTC connection and screen streaming

    Ok(())
}
```

**Success Criteria**:
- Agent starts without errors
- Loads configuration
- Initializes all modules
- Connects to signaling server
- Logs appear in console

**Testing**:
```bash
cd /Users/roberisaacs/alga-psa/.conductor/tirana/ee/remote-desktop-agent
RUST_LOG=info cargo run
```

</details>

**Week 3 Checklist**:
- [ ] Rust project compiles on Windows
- [ ] Configuration system working
- [ ] Screen capture functional (can see frame data)
- [ ] Input injection tested manually
- [ ] WebSocket connection to signaling server works
- [ ] Agent shows as "online" in database
- [ ] All unit tests passing

---

### Week 4: Browser Client & Integration

**Focus**: Build React components for remote desktop viewer and complete end-to-end integration

#### Goals
- React component for desktop viewer
- WebRTC connection from browser to agent
- Mouse/keyboard input sent from browser
- End-to-end demo working

#### Tasks

##### 4.1 React Component Structure

<details>
<summary><strong>Create RemoteDesktopViewer component</strong></summary>

**File**: `/Users/roberisaacs/alga-psa/.conductor/tirana/server/src/components/RemoteDesktop/RemoteDesktopViewer.tsx`

**Implementation**:

```typescript
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

interface RemoteDesktopViewerProps {
  sessionId: string;
  agentId: string;
  onDisconnect?: () => void;
}

export const RemoteDesktopViewer: React.FC<RemoteDesktopViewerProps> = ({
  sessionId,
  agentId,
  onDisconnect,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [connected, setConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    initializeConnection();

    return () => {
      cleanup();
    };
  }, [sessionId]);

  const initializeConnection = async () => {
    try {
      // Create WebSocket connection to signaling server
      const token = localStorage.getItem('auth_token'); // Get from your auth system
      const wsUrl = `ws://localhost:8080/ws/rd-signal?token=${token}&role=engineer`;

      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('WebSocket connected');

        // Request session
        wsRef.current?.send(JSON.stringify({
          type: 'session-request',
          sessionId,
          senderId: 'engineer-' + Date.now(),
          payload: {},
          timestamp: Date.now(),
        }));
      };

      wsRef.current.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        await handleSignalingMessage(message);
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      wsRef.current.onclose = () => {
        console.log('WebSocket disconnected');
        setConnected(false);
      };

      // Create WebRTC peer connection
      await createPeerConnection();

    } catch (error) {
      console.error('Failed to initialize connection:', error);
    }
  };

  const createPeerConnection = async () => {
    const config: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    };

    peerConnectionRef.current = new RTCPeerConnection(config);

    // Handle ICE candidates
    peerConnectionRef.current.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          sessionId,
          senderId: 'engineer',
          payload: event.candidate,
          timestamp: Date.now(),
        }));
      }
    };

    // Handle incoming video stream
    peerConnectionRef.current.ontrack = (event) => {
      console.log('Received remote track');
      if (videoRef.current) {
        videoRef.current.srcObject = event.streams[0];
        setConnected(true);
      }
    };

    // Monitor connection state
    peerConnectionRef.current.onconnectionstatechange = () => {
      const state = peerConnectionRef.current?.connectionState;
      console.log('Connection state:', state);
      setConnectionState(state || 'new');

      if (state === 'connected') {
        setConnected(true);
      } else if (state === 'disconnected' || state === 'failed') {
        setConnected(false);
      }
    };

    // Create data channel for input events
    const dataChannel = peerConnectionRef.current.createDataChannel('input');
    dataChannel.onopen = () => {
      console.log('Data channel opened');
    };

    // Store data channel for sending input
    (peerConnectionRef.current as any).inputChannel = dataChannel;
  };

  const handleSignalingMessage = async (message: any) => {
    console.log('Signaling message:', message.type);

    switch (message.type) {
      case 'session-accept':
        console.log('Session accepted by agent');
        await createOffer();
        break;

      case 'session-deny':
        console.log('Session denied by agent');
        alert('Remote user denied the connection request');
        break;

      case 'answer':
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.setRemoteDescription(
            new RTCSessionDescription(message.payload)
          );
        }
        break;

      case 'ice-candidate':
        if (peerConnectionRef.current && message.payload) {
          await peerConnectionRef.current.addIceCandidate(
            new RTCIceCandidate(message.payload)
          );
        }
        break;
    }
  };

  const createOffer = async () => {
    if (!peerConnectionRef.current) return;

    try {
      const offer = await peerConnectionRef.current.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: false,
      });

      await peerConnectionRef.current.setLocalDescription(offer);

      // Send offer to agent via signaling
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'offer',
          sessionId,
          senderId: 'engineer',
          payload: offer,
          timestamp: Date.now(),
        }));
      }
    } catch (error) {
      console.error('Failed to create offer:', error);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!connected || !videoRef.current) return;

    const rect = videoRef.current.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / rect.width * 1920); // Assume 1920x1080
    const y = Math.floor((e.clientY - rect.top) / rect.height * 1080);

    sendInputEvent({
      type: 'MouseMove',
      x,
      y,
    });
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!connected) return;

    const button = e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'middle';
    sendInputEvent({
      type: 'MouseDown',
      button,
    });
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!connected) return;

    const button = e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'middle';
    sendInputEvent({
      type: 'MouseUp',
      button,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!connected) return;

    e.preventDefault();
    sendInputEvent({
      type: 'KeyDown',
      key: e.key,
    });
  };

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (!connected) return;

    e.preventDefault();
    sendInputEvent({
      type: 'KeyUp',
      key: e.key,
    });
  };

  const sendInputEvent = (event: any) => {
    const pc = peerConnectionRef.current as any;
    if (pc?.inputChannel?.readyState === 'open') {
      pc.inputChannel.send(JSON.stringify(event));
    }
  };

  const cleanup = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const handleDisconnectClick = () => {
    cleanup();
    onDisconnect?.();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 bg-gray-100 border-b">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-sm font-medium">
            {connected ? 'Connected' : 'Connecting...'}
          </span>
          <span className="text-xs text-gray-500">({connectionState})</span>
        </div>
        <Button onClick={handleDisconnectClick} variant="destructive" size="sm">
          Disconnect
        </Button>
      </div>

      <div className="flex-1 bg-black flex items-center justify-center">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="max-w-full max-h-full cursor-pointer"
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          tabIndex={0}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>

      {!connected && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
          <div className="text-white text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-white mx-auto mb-4" />
            <p>Establishing connection...</p>
          </div>
        </div>
      )}
    </div>
  );
};
```

**Success Criteria**:
- Component renders without errors
- Video element displays stream
- Mouse events captured correctly
- Keyboard events captured
- Connection state displayed
- Disconnect button works

</details>

##### 4.2 Session Management Page

<details>
<summary><strong>Create page to list agents and start sessions</strong></summary>

**File**: `/Users/roberisaacs/alga-psa/.conductor/tirana/server/src/app/(pages)/remote-desktop/page.tsx`

**Implementation**:

```typescript
'use client';

import React, { useState, useEffect } from 'react';
import { RemoteDesktopViewer } from '@/components/RemoteDesktop/RemoteDesktopViewer';
import { Button } from '@/components/ui/button';
import { IRemoteAgent } from '@/types/remoteDesktop';

export default function RemoteDesktopPage() {
  const [agents, setAgents] = useState<IRemoteAgent[]>([]);
  const [activeSession, setActiveSession] = useState<{
    sessionId: string;
    agentId: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    try {
      const response = await fetch('/api/v1/remote-desktop/agents', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      });

      const data = await response.json();
      if (data.success) {
        setAgents(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch agents:', error);
    } finally {
      setLoading(false);
    }
  };

  const startSession = async (agentId: string) => {
    try {
      const response = await fetch('/api/v1/remote-desktop/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({ agent_id: agentId }),
      });

      const data = await response.json();
      if (data.success) {
        setActiveSession({
          sessionId: data.data.session_id,
          agentId,
        });
      } else {
        alert(`Failed to start session: ${data.error}`);
      }
    } catch (error) {
      console.error('Failed to start session:', error);
      alert('Failed to start session');
    }
  };

  const endSession = async () => {
    if (!activeSession) return;

    try {
      await fetch(`/api/v1/remote-desktop/sessions/${activeSession.sessionId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      });
    } catch (error) {
      console.error('Failed to end session:', error);
    } finally {
      setActiveSession(null);
    }
  };

  if (activeSession) {
    return (
      <div className="h-screen">
        <RemoteDesktopViewer
          sessionId={activeSession.sessionId}
          agentId={activeSession.agentId}
          onDisconnect={endSession}
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-8">Remote Desktop</h1>

      {loading ? (
        <p>Loading agents...</p>
      ) : agents.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">No agents registered yet</p>
          <p className="text-sm text-gray-400">
            Install the Remote Desktop Agent on a client machine to get started
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <div
              key={agent.agent_id}
              className="border rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">{agent.agent_name}</h3>
                <div
                  className={`w-3 h-3 rounded-full ${
                    agent.status === 'online' ? 'bg-green-500' : 'bg-gray-400'
                  }`}
                />
              </div>

              <div className="space-y-2 text-sm text-gray-600 mb-4">
                <p>
                  <span className="font-medium">Hostname:</span> {agent.hostname}
                </p>
                <p>
                  <span className="font-medium">OS:</span>{' '}
                  {agent.os_type === 'windows' ? 'Windows' : 'macOS'}{' '}
                  {agent.os_version}
                </p>
                <p>
                  <span className="font-medium">Version:</span> {agent.agent_version}
                </p>
                {agent.last_seen_at && (
                  <p>
                    <span className="font-medium">Last seen:</span>{' '}
                    {new Date(agent.last_seen_at).toLocaleString()}
                  </p>
                )}
              </div>

              <Button
                onClick={() => startSession(agent.agent_id)}
                disabled={agent.status !== 'online'}
                className="w-full"
              >
                {agent.status === 'online' ? 'Connect' : 'Offline'}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Success Criteria**:
- Page displays list of agents
- Online/offline status shown correctly
- Can click "Connect" to start session
- Session viewer opens in full screen
- Disconnect returns to agent list

</details>

##### 4.3 Integration Testing

<details>
<summary><strong>Create end-to-end integration test</strong></summary>

**File**: `/Users/roberisaacs/alga-psa/.conductor/tirana/server/src/test/integration/remoteDesktop.test.ts`

**Implementation**:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Knex from 'knex';
import { getKnexConfigWithTenant } from '@/lib/db/knexfile';

describe('Remote Desktop Integration', () => {
  let knex: Knex.Knex;
  const tenant = 'default';
  let agentId: string;

  beforeAll(async () => {
    const config = await getKnexConfigWithTenant(tenant);
    knex = Knex(config);

    // Insert test agent
    const [agent] = await knex('rd_agents').insert({
      tenant,
      agent_name: 'Test Agent',
      hostname: 'TEST-WIN-01',
      os_type: 'windows',
      os_version: '10',
      agent_version: '0.1.0',
      status: 'online',
      connection_token: 'test-token-123',
    }).returning('*');

    agentId = agent.agent_id;
  });

  afterAll(async () => {
    // Clean up test data
    await knex('rd_session_events').where({ tenant }).delete();
    await knex('rd_sessions').where({ tenant }).delete();
    await knex('rd_agents').where({ tenant }).delete();
    await knex.destroy();
  });

  it('should create agent record', async () => {
    const agent = await knex('rd_agents')
      .where({ tenant, agent_id: agentId })
      .first();

    expect(agent).toBeDefined();
    expect(agent.agent_name).toBe('Test Agent');
    expect(agent.status).toBe('online');
  });

  it('should create session record', async () => {
    const [session] = await knex('rd_sessions').insert({
      tenant,
      agent_id: agentId,
      engineer_user_id: 'test-user-id',
      status: 'pending',
    }).returning('*');

    expect(session).toBeDefined();
    expect(session.status).toBe('pending');
    expect(session.agent_id).toBe(agentId);
  });

  it('should log session events', async () => {
    const [session] = await knex('rd_sessions').insert({
      tenant,
      agent_id: agentId,
      engineer_user_id: 'test-user-id',
      status: 'pending',
    }).returning('*');

    await knex('rd_session_events').insert({
      tenant,
      session_id: session.session_id,
      event_type: 'session_requested',
      event_data: { test: true },
    });

    const events = await knex('rd_session_events')
      .where({ tenant, session_id: session.session_id });

    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('session_requested');
  });

  it('should update session status', async () => {
    const [session] = await knex('rd_sessions').insert({
      tenant,
      agent_id: agentId,
      engineer_user_id: 'test-user-id',
      status: 'pending',
    }).returning('*');

    await knex('rd_sessions')
      .where({ tenant, session_id: session.session_id })
      .update({ status: 'active', started_at: knex.fn.now() });

    const updated = await knex('rd_sessions')
      .where({ tenant, session_id: session.session_id })
      .first();

    expect(updated.status).toBe('active');
    expect(updated.started_at).toBeDefined();
  });
});
```

**Success Criteria**:
- All tests pass
- Database operations work correctly
- Can create and manage sessions
- Events logged properly

**Testing**:
```bash
cd /Users/roberisaacs/alga-psa/.conductor/tirana/server
npm run test:integration -- remoteDesktop.test.ts
```

</details>

##### 4.4 Manual Testing Checklist

<details>
<summary><strong>End-to-end manual test procedure</strong></summary>

**Prerequisites**:
- Server running on localhost:3000
- Signaling server running on localhost:8080
- Windows VM or machine with agent installed
- Browser with webcam/mic permissions (for testing)

**Test Procedure**:

1. **Agent Registration**
   - [ ] Start agent on Windows machine
   - [ ] Agent appears in database with status 'online'
   - [ ] Agent visible in UI agent list

2. **Session Creation**
   - [ ] Click "Connect" on online agent
   - [ ] Session created in database with status 'pending'
   - [ ] Agent receives session request via WebSocket

3. **Connection Establishment**
   - [ ] WebRTC offer/answer exchange completes
   - [ ] ICE candidates exchanged
   - [ ] Peer connection state becomes 'connected'
   - [ ] Session status updates to 'active'

4. **Screen Sharing**
   - [ ] Remote desktop screen appears in browser
   - [ ] Frame rate ≥15 FPS
   - [ ] No obvious lag or freezing
   - [ ] Screen updates when agent desktop changes

5. **Input Control**
   - [ ] Mouse moves on agent screen
   - [ ] Mouse clicks work (left, right)
   - [ ] Keyboard input types correctly
   - [ ] Special keys work (arrows, Enter, etc.)

6. **Session Termination**
   - [ ] Click "Disconnect" button
   - [ ] Session ends gracefully
   - [ ] Session status updates to 'ended'
   - [ ] Agent status remains 'online'
   - [ ] Return to agent list

7. **Error Scenarios**
   - [ ] Try connecting to offline agent (should fail with error)
   - [ ] Disconnect agent during session (should handle gracefully)
   - [ ] Close browser during session (session should end)

**Success Criteria**:
All checklist items pass without critical errors

</details>

**Week 4 Checklist**:
- [ ] RemoteDesktopViewer component implemented
- [ ] Session management page working
- [ ] WebRTC connection establishes successfully
- [ ] Video stream displays in browser
- [ ] Mouse control working
- [ ] Keyboard control working
- [ ] Integration tests passing
- [ ] Manual end-to-end test successful
- [ ] No console errors in browser or server

---

## Directory Structure

```
/Users/roberisaacs/alga-psa/.conductor/tirana/
├── server/
│   ├── migrations/
│   │   └── YYYYMMDDHHMMSS_create_remote_desktop_tables.cjs
│   ├── src/
│   │   ├── types/
│   │   │   └── remoteDesktop.ts
│   │   ├── lib/
│   │   │   ├── api/
│   │   │   │   └── controllers/
│   │   │   │       └── ApiRemoteDesktopController.ts
│   │   │   └── remoteDesktop/
│   │   │       ├── SignalingServer.ts
│   │   │       └── index.ts
│   │   ├── components/
│   │   │   └── RemoteDesktop/
│   │   │       └── RemoteDesktopViewer.tsx
│   │   ├── app/
│   │   │   ├── (pages)/
│   │   │   │   └── remote-desktop/
│   │   │   │       └── page.tsx
│   │   │   └── api/
│   │   │       └── v1/
│   │   │           └── remote-desktop/
│   │   │               ├── agents/
│   │   │               │   ├── route.ts
│   │   │               │   └── [agentId]/
│   │   │               │       └── route.ts
│   │   │               └── sessions/
│   │   │                   ├── route.ts
│   │   │                   └── [sessionId]/
│   │   │                       └── route.ts
│   │   └── test/
│   │       ├── integration/
│   │       │   └── remoteDesktop.test.ts
│   │       └── helpers/
│   │           └── wsTestClient.ts
│   └── index.ts (modified)
│
└── ee/
    ├── docs/
    │   ├── dev-environment/
    │   │   └── remote-desktop-setup.md
    │   └── plans/
    │       └── remote-desktop-phase1-foundation.md (this file)
    │
    └── remote-desktop-agent/
        ├── Cargo.toml
        ├── config.toml
        └── src/
            ├── main.rs
            ├── config.rs
            ├── capture.rs
            ├── input.rs
            └── signaling.rs
```

---

## Database Schema

### Tables Created

#### `rd_agents`
Stores information about remote desktop agents (installed on client machines)

**Columns**:
- `tenant` (UUID, FK) - Multi-tenant isolation
- `agent_id` (UUID, PK) - Unique agent identifier
- `agent_name` (TEXT) - User-friendly name
- `hostname` (TEXT) - Machine hostname
- `os_type` (TEXT) - 'windows' or 'macos'
- `os_version` (TEXT) - OS version string
- `company_id` (UUID, nullable) - Associated client company
- `agent_version` (TEXT) - Agent software version
- `status` (TEXT) - 'online', 'offline', 'suspended'
- `last_seen_at` (TIMESTAMP) - Last heartbeat time
- `registered_at` (TIMESTAMP) - Initial registration
- `metadata` (JSONB) - Additional system info
- `connection_token` (TEXT) - Secret for agent authentication

**Indexes**:
- `(tenant, status)` - Query online agents
- `(tenant, company_id)` - Filter by company

#### `rd_sessions`
Tracks remote desktop sessions between engineers and agents

**Columns**:
- `tenant` (UUID, FK)
- `session_id` (UUID, PK)
- `agent_id` (UUID, FK)
- `engineer_user_id` (UUID, FK)
- `status` (TEXT) - 'pending', 'active', 'ended', 'denied', 'failed'
- `requested_at` (TIMESTAMP)
- `started_at` (TIMESTAMP, nullable)
- `ended_at` (TIMESTAMP, nullable)
- `end_reason` (TEXT, nullable)
- `connection_metadata` (JSONB) - Connection quality, ICE info
- `duration_seconds` (INTEGER, nullable)

**Indexes**:
- `(tenant, status)` - Query active sessions
- `(tenant, agent_id)` - Session history per agent
- `(tenant, engineer_user_id)` - Session history per engineer

#### `rd_session_events`
Audit log for all session activities

**Columns**:
- `tenant` (UUID, FK)
- `event_id` (UUID, PK)
- `session_id` (UUID, FK)
- `event_type` (TEXT) - Event category
- `event_data` (JSONB) - Event-specific data
- `timestamp` (TIMESTAMP)

**Indexes**:
- `(tenant, session_id, timestamp)` - Event timeline per session

---

## API Endpoints

### Agents

#### `GET /api/v1/remote-desktop/agents`
List all agents for the authenticated tenant

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "agent_id": "uuid",
      "agent_name": "Client-PC-01",
      "hostname": "WIN-CLIENT-01",
      "os_type": "windows",
      "os_version": "10",
      "status": "online",
      "last_seen_at": "2025-12-05T10:30:00Z",
      "agent_version": "0.1.0"
    }
  ]
}
```

#### `GET /api/v1/remote-desktop/agents/:agentId`
Get details for a specific agent

**Response**: Single agent object

### Sessions

#### `POST /api/v1/remote-desktop/sessions`
Create a new remote session

**Request**:
```json
{
  "agent_id": "uuid"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "session_id": "uuid",
    "status": "pending",
    "agent_info": {
      "agent_id": "uuid",
      "agent_name": "Client-PC-01",
      "hostname": "WIN-CLIENT-01",
      "os_type": "windows"
    }
  }
}
```

#### `GET /api/v1/remote-desktop/sessions/:sessionId`
Get session details and event history

**Response**:
```json
{
  "success": true,
  "data": {
    "session_id": "uuid",
    "status": "active",
    "started_at": "2025-12-05T10:35:00Z",
    "agent": { ... },
    "events": [
      {
        "event_type": "session_requested",
        "timestamp": "2025-12-05T10:35:00Z"
      },
      {
        "event_type": "connection_established",
        "timestamp": "2025-12-05T10:35:05Z"
      }
    ]
  }
}
```

#### `DELETE /api/v1/remote-desktop/sessions/:sessionId`
End an active session

**Response**:
```json
{
  "success": true,
  "message": "Session ended successfully"
}
```

#### `GET /api/v1/remote-desktop/sessions`
List sessions with optional filters

**Query Parameters**:
- `agent_id` (optional) - Filter by agent
- `status` (optional) - Filter by status

---

## Testing Strategy

### Unit Tests

**Coverage Goals**:
- API controller methods: 100%
- TypeScript utility functions: 90%+
- Rust modules (capture, input, signaling): 80%+

**Test Files**:
- `/Users/roberisaacs/alga-psa/.conductor/tirana/server/src/test/unit/remoteDesktop/controller.test.ts`
- `/Users/roberisaacs/alga-psa/.conductor/tirana/ee/remote-desktop-agent/src/capture.rs` (inline tests)
- `/Users/roberisaacs/alga-psa/.conductor/tirana/ee/remote-desktop-agent/src/input.rs` (inline tests)

### Integration Tests

**Test Scenarios**:
1. Database operations (CRUD for agents, sessions, events)
2. WebSocket connection and message routing
3. Session lifecycle (pending → active → ended)
4. Error handling (offline agents, invalid tokens)

**Test File**:
- `/Users/roberisaacs/alga-psa/.conductor/tirana/server/src/test/integration/remoteDesktop.test.ts`

### End-to-End Tests

**Manual Testing Checklist** (see Week 4, Task 4.4 above)

**Automated E2E** (Nice-to-have, not required for Phase 1):
- Playwright tests for browser interactions
- Would require mock WebRTC connections

---

## Dependencies & Risks

### Technical Dependencies

**External Libraries**:
- `ws` - WebSocket server (server)
- `webrtc-rs` - WebRTC implementation (agent)
- `scrap` - Screen capture (agent)
- `enigo` - Input injection (agent)

**Internal Dependencies**:
- Existing Alga PSA auth system
- PostgreSQL database
- Next.js routing infrastructure

### Known Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| WebRTC connection fails behind corporate firewall | Medium | High | Implement TURN relay fallback |
| Screen capture performance poor | Low | Medium | Start with lower FPS, optimize in Phase 2 |
| Rust/Windows compilation issues | Medium | Medium | Test on multiple Windows versions early |
| Input injection blocked by UAC | High | High | Document elevation requirement clearly |
| Browser compatibility issues | Low | Low | Test on Chrome/Edge/Firefox |

### Phase 2 Dependencies

Phase 2 (macOS support, file transfer, terminal) depends on:
- ✅ Stable signaling protocol (defined in Phase 1)
- ✅ Agent architecture supporting pluggable capture modules
- ✅ Data channel infrastructure (created in Phase 1)
- ✅ Session management working reliably

---

## Success Metrics

### Technical Metrics

- [ ] **Connection Success Rate**: >90% of connection attempts succeed
- [ ] **Latency**: <200ms round-trip for input events (local network)
- [ ] **Frame Rate**: ≥15 FPS for desktop streaming
- [ ] **Test Coverage**: ≥80% for critical paths
- [ ] **Build Success**: Agent compiles on Windows without errors

### Functional Metrics

- [ ] **End-to-End Demo**: Complete demo showing:
  - Agent registration
  - Session initiation
  - Screen viewing
  - Mouse/keyboard control
  - Session termination

- [ ] **API Completeness**: All planned endpoints implemented and tested

### Documentation Metrics

- [ ] **Developer Setup**: New developer can set up in <30 minutes
- [ ] **Code Documentation**: All public APIs have JSDoc/rustdoc comments

---

## Next Steps (Phase 2 Preview)

After Phase 1 completion, Phase 2 will focus on:

1. **macOS Agent**
   - Adapt capture module for macOS
   - Test input injection on macOS
   - Handle permissions (Screen Recording, Accessibility)

2. **File Transfer**
   - Implement file upload/download via data channel
   - Progress indicators
   - Pause/resume support

3. **Terminal Access**
   - PTY integration (agent side)
   - xterm.js integration (browser side)
   - Command history and autocomplete

4. **Enhanced Security**
   - End-to-end encryption for data channels
   - Session recording (optional)
   - RBAC (who can initiate sessions)

---

## Appendix

### Environment Variables

Add to `/Users/roberisaacs/alga-psa/.conductor/tirana/server/.env`:

```bash
# Remote Desktop Configuration
WS_SIGNALING_PORT=8080
TURN_SERVER_URL=turn:turn.example.com:3478
TURN_USERNAME=your-username
TURN_PASSWORD=your-password
```

### Useful Commands

```bash
# Server
cd /Users/roberisaacs/alga-psa/.conductor/tirana/server
npm run dev                    # Start dev server
npx knex migrate:latest        # Run migrations
npm run test:integration       # Run integration tests

# Agent
cd /Users/roberisaacs/alga-psa/.conductor/tirana/ee/remote-desktop-agent
cargo build                    # Build agent
cargo test                     # Run tests
RUST_LOG=info cargo run        # Run agent with logging
```

### Troubleshooting

**WebSocket connection fails**:
- Check firewall allows port 8080
- Verify token is valid and not expired
- Check server logs for auth errors

**Screen capture not working**:
- Verify `scrap` crate supports your Windows version
- Check graphics driver compatibility
- Try running agent as administrator

**Input injection not working**:
- Agent must run with appropriate permissions
- UAC may block some inputs - document elevation
- Test with simple inputs first (mouse move)

**WebRTC connection stuck on "connecting"**:
- Check ICE candidates are being exchanged
- Verify STUN server is reachable
- May need TURN relay for restrictive networks

---

## Glossary

- **Agent**: Desktop application running on client machine
- **Engineer**: MSP technician connecting to remote machine
- **Signaling**: Process of exchanging connection info for WebRTC
- **ICE**: Interactive Connectivity Establishment (NAT traversal)
- **STUN**: Session Traversal Utilities for NAT (discovers public IP)
- **TURN**: Traversal Using Relays around NAT (relays media when direct connection fails)
- **SDP**: Session Description Protocol (describes media capabilities)
- **Data Channel**: WebRTC channel for non-media data (input events, files, etc.)

---

**End of Phase 1 Implementation Plan**

For questions or clarifications, refer to the master plan at:
`/Users/roberisaacs/alga-psa/.conductor/tirana/ee/docs/plans/remote-desktop-support.md`
