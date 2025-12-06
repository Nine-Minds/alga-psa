/**
 * Remote Desktop API Controller
 * Handles HTTP requests for remote desktop agent and session management
 */

import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex, runWithTenant } from '@/lib/db';
import { getConnection } from '@/lib/db/db';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import {
  IRemoteAgent,
  IRemoteSession,
  ISessionEvent,
  CreateAgentRequest,
  UpdateAgentRequest,
  CreateSessionRequest,
  CreateSessionResponse,
  SessionDetailsResponse,
  AgentStatus,
  SessionStatus,
  SessionEventType,
} from '@/types/remoteDesktop';
import {
  ApiRequest,
  AuthenticatedApiRequest,
  UnauthorizedError,
  NotFoundError,
  BadRequestError,
  ValidationError,
  handleApiError,
  createSuccessResponse,
  createPaginatedResponse,
} from '../middleware/apiMiddleware';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { findUserByIdForApi } from '@/lib/actions/user-actions/findUserByIdForApi';
import {
  RemoteAccessPermission,
  DEFAULT_PERMISSIONS,
  sanitizePermissions,
  validatePermissions,
} from '@/lib/remote-desktop/permissions';
import { getIceServersForSession } from '@/lib/remote-desktop/turn';

export class ApiRemoteDesktopController {

  /**
   * Authenticate request and set context
   */
  private async authenticate(req: NextRequest): Promise<AuthenticatedApiRequest> {
    const apiKey = req.headers.get('x-api-key');

    if (!apiKey) {
      throw new UnauthorizedError('API key required');
    }

    // Extract tenant ID from header
    let tenantId = req.headers.get('x-tenant-id');
    let keyRecord;

    if (tenantId) {
      // If tenant is provided, validate key for that specific tenant
      keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
    } else {
      // Otherwise, search across all tenants
      keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
      if (keyRecord) {
        tenantId = keyRecord.tenant;
      }
    }

    if (!keyRecord) {
      throw new UnauthorizedError('Invalid API key');
    }

    // Get user within tenant context
    const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    // Create extended request with context
    const apiRequest = req as AuthenticatedApiRequest;
    apiRequest.context = {
      userId: keyRecord.user_id,
      tenant: keyRecord.tenant,
      user
    };

    return apiRequest;
  }

  /**
   * GET /api/v1/remote-desktop/agents
   * List all agents for the tenant
   */
  listAgents() {
    return async (request: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(request);
        const tenant = apiRequest.context.tenant;

        return await runWithTenant(tenant, async () => {
          const knex = await getConnection(tenant);

          const { searchParams } = new URL(request.url);
          const status = searchParams.get('status');
          const companyId = searchParams.get('company_id');
          const page = parseInt(searchParams.get('page') || '1');
          const limit = Math.min(parseInt(searchParams.get('limit') || '25'), 100);
          const offset = (page - 1) * limit;

          let query = knex('rd_agents')
            .where({ tenant })
            .orderBy('agent_name', 'asc');

          let countQuery = knex('rd_agents')
            .where({ tenant })
            .count('* as count');

          if (status) {
            query = query.where({ status });
            countQuery = countQuery.where({ status });
          }

          if (companyId) {
            query = query.where({ company_id: companyId });
            countQuery = countQuery.where({ company_id: companyId });
          }

          const [agents, countResult] = await Promise.all([
            query.limit(limit).offset(offset).select('*'),
            countQuery.first()
          ]);

          const total = parseInt((countResult as any)?.count || '0');

          return createPaginatedResponse(agents, total, page, limit);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * GET /api/v1/remote-desktop/agents/:agentId
   * Get details for a specific agent
   */
  getAgent() {
    return async (request: NextRequest, context: { params: Promise<{ agentId: string }> }): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(request);
        const tenant = apiRequest.context.tenant;
        const { agentId } = await context.params;

        return await runWithTenant(tenant, async () => {
          const knex = await getConnection(tenant);

          const agent: IRemoteAgent | undefined = await knex('rd_agents')
            .where({ tenant, agent_id: agentId })
            .first();

          if (!agent) {
            throw new NotFoundError('Agent not found');
          }

          return createSuccessResponse(agent);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v1/remote-desktop/agents
   * Register a new agent
   */
  createAgent() {
    return async (request: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(request);
        const tenant = apiRequest.context.tenant;
        const body: CreateAgentRequest = await request.json();

        // Validate required fields
        if (!body.agent_name || !body.hostname || !body.os_type || !body.agent_version) {
          throw new ValidationError('Missing required fields: agent_name, hostname, os_type, agent_version');
        }

        if (body.os_type !== 'windows' && body.os_type !== 'macos') {
          throw new ValidationError('Invalid os_type. Must be "windows" or "macos"');
        }

        return await runWithTenant(tenant, async () => {
          const knex = await getConnection(tenant);

          // Generate a connection token for the agent
          const connectionToken = `${tenant}:${uuidv4()}:${uuidv4()}`;

          const [agent] = await knex('rd_agents')
            .insert({
              tenant,
              agent_name: body.agent_name,
              hostname: body.hostname,
              os_type: body.os_type,
              os_version: body.os_version,
              company_id: body.company_id,
              agent_version: body.agent_version,
              status: 'offline',
              metadata: body.metadata || {},
              connection_token: connectionToken,
              registered_at: knex.fn.now(),
            })
            .returning('*');

          return createSuccessResponse(agent, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * PUT /api/v1/remote-desktop/agents/:agentId
   * Update an agent
   */
  updateAgent() {
    return async (request: NextRequest, context: { params: Promise<{ agentId: string }> }): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(request);
        const tenant = apiRequest.context.tenant;
        const { agentId } = await context.params;
        const body: UpdateAgentRequest = await request.json();

        return await runWithTenant(tenant, async () => {
          const knex = await getConnection(tenant);

          // Check agent exists
          const existingAgent = await knex('rd_agents')
            .where({ tenant, agent_id: agentId })
            .first();

          if (!existingAgent) {
            throw new NotFoundError('Agent not found');
          }

          const updateData: Partial<IRemoteAgent> = {};
          if (body.agent_name !== undefined) updateData.agent_name = body.agent_name;
          if (body.os_version !== undefined) updateData.os_version = body.os_version;
          if (body.company_id !== undefined) updateData.company_id = body.company_id;
          if (body.agent_version !== undefined) updateData.agent_version = body.agent_version;
          if (body.status !== undefined) updateData.status = body.status;
          if (body.metadata !== undefined) updateData.metadata = body.metadata as any;

          const [updatedAgent] = await knex('rd_agents')
            .where({ tenant, agent_id: agentId })
            .update(updateData)
            .returning('*');

          return createSuccessResponse(updatedAgent);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * DELETE /api/v1/remote-desktop/agents/:agentId
   * Unregister an agent
   */
  deleteAgent() {
    return async (request: NextRequest, context: { params: Promise<{ agentId: string }> }): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(request);
        const tenant = apiRequest.context.tenant;
        const { agentId } = await context.params;

        return await runWithTenant(tenant, async () => {
          const knex = await getConnection(tenant);

          const deleted = await knex('rd_agents')
            .where({ tenant, agent_id: agentId })
            .delete();

          if (deleted === 0) {
            throw new NotFoundError('Agent not found');
          }

          return new NextResponse(null, { status: 204 });
        });
      } catch (error) {
        return handleApiError(error);
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
        const apiRequest = await this.authenticate(request);
        const tenant = apiRequest.context.tenant;
        const userId = apiRequest.context.userId;
        const body: CreateSessionRequest = await request.json();

        if (!body.agent_id) {
          throw new ValidationError('Missing required field: agent_id');
        }

        return await runWithTenant(tenant, async () => {
          const knex = await getConnection(tenant);

          // Verify agent exists and is online
          const agent: IRemoteAgent | undefined = await knex('rd_agents')
            .where({ tenant, agent_id: body.agent_id })
            .first();

          if (!agent) {
            throw new NotFoundError('Agent not found');
          }

          if (agent.status !== 'online') {
            throw new BadRequestError('Agent is not online');
          }

          // Create session record
          const [session] = await knex('rd_sessions')
            .insert({
              tenant,
              agent_id: body.agent_id,
              engineer_user_id: userId,
              status: 'pending',
              requested_at: knex.fn.now(),
            })
            .returning('*');

          // Log session request event
          await knex('rd_session_events').insert({
            tenant,
            session_id: session.session_id,
            event_type: 'session_requested',
            event_data: { user_id: userId },
            timestamp: knex.fn.now(),
          });

          const response: CreateSessionResponse = {
            session_id: session.session_id,
            status: session.status,
            agent_info: {
              agent_id: agent.agent_id,
              agent_name: agent.agent_name,
              hostname: agent.hostname,
              os_type: agent.os_type,
            },
          };

          return createSuccessResponse(response, 201);
        });
      } catch (error) {
        return handleApiError(error);
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
        const apiRequest = await this.authenticate(request);
        const tenant = apiRequest.context.tenant;

        return await runWithTenant(tenant, async () => {
          const knex = await getConnection(tenant);

          const { searchParams } = new URL(request.url);
          const agentId = searchParams.get('agent_id');
          const status = searchParams.get('status');
          const page = parseInt(searchParams.get('page') || '1');
          const limit = Math.min(parseInt(searchParams.get('limit') || '25'), 100);
          const offset = (page - 1) * limit;

          let query = knex('rd_sessions')
            .where({ tenant })
            .orderBy('requested_at', 'desc');

          let countQuery = knex('rd_sessions')
            .where({ tenant })
            .count('* as count');

          if (agentId) {
            query = query.where({ agent_id: agentId });
            countQuery = countQuery.where({ agent_id: agentId });
          }

          if (status) {
            query = query.where({ status });
            countQuery = countQuery.where({ status });
          }

          const [sessions, countResult] = await Promise.all([
            query.limit(limit).offset(offset).select('*'),
            countQuery.first()
          ]);

          const total = parseInt((countResult as any)?.count || '0');

          return createPaginatedResponse(sessions, total, page, limit);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * GET /api/v1/remote-desktop/sessions/:sessionId
   * Get session details including events
   */
  getSession() {
    return async (request: NextRequest, context: { params: Promise<{ sessionId: string }> }): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(request);
        const tenant = apiRequest.context.tenant;
        const { sessionId } = await context.params;

        return await runWithTenant(tenant, async () => {
          const knex = await getConnection(tenant);

          const session: IRemoteSession | undefined = await knex('rd_sessions')
            .where({ tenant, session_id: sessionId })
            .first();

          if (!session) {
            throw new NotFoundError('Session not found');
          }

          // Get agent details
          const agent: IRemoteAgent = await knex('rd_agents')
            .where({ tenant, agent_id: session.agent_id })
            .first();

          // Get session events
          const events: ISessionEvent[] = await knex('rd_session_events')
            .where({ tenant, session_id: sessionId })
            .orderBy('timestamp', 'asc');

          const response: SessionDetailsResponse = {
            ...session,
            agent,
            events,
          };

          return createSuccessResponse(response);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * DELETE /api/v1/remote-desktop/sessions/:sessionId
   * End an active session
   */
  endSession() {
    return async (request: NextRequest, context: { params: Promise<{ sessionId: string }> }): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(request);
        const tenant = apiRequest.context.tenant;
        const userId = apiRequest.context.userId;
        const { sessionId } = await context.params;

        return await runWithTenant(tenant, async () => {
          const knex = await getConnection(tenant);

          const session: IRemoteSession | undefined = await knex('rd_sessions')
            .where({ tenant, session_id: sessionId })
            .first();

          if (!session) {
            throw new NotFoundError('Session not found');
          }

          if (session.status === 'ended') {
            throw new BadRequestError('Session already ended');
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
              duration_seconds: duration,
            });

          // Log event
          await knex('rd_session_events').insert({
            tenant,
            session_id: sessionId,
            event_type: 'session_ended',
            event_data: { user_id: userId, reason: 'user_disconnect' },
            timestamp: knex.fn.now(),
          });

          return createSuccessResponse({ message: 'Session ended successfully' });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v1/remote-desktop/sessions/:sessionId/events
   * Log a session event
   */
  logSessionEvent() {
    return async (request: NextRequest, context: { params: Promise<{ sessionId: string }> }): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(request);
        const tenant = apiRequest.context.tenant;
        const { sessionId } = await context.params;
        const body = await request.json();

        if (!body.event_type) {
          throw new ValidationError('Missing required field: event_type');
        }

        return await runWithTenant(tenant, async () => {
          const knex = await getConnection(tenant);

          // Verify session exists
          const session = await knex('rd_sessions')
            .where({ tenant, session_id: sessionId })
            .first();

          if (!session) {
            throw new NotFoundError('Session not found');
          }

          const [event] = await knex('rd_session_events')
            .insert({
              tenant,
              session_id: sessionId,
              event_type: body.event_type,
              event_data: body.event_data || {},
              timestamp: knex.fn.now(),
            })
            .returning('*');

          return createSuccessResponse(event, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v1/remote-desktop/agents/:agentId/regenerate-token
   * Regenerate connection token for an agent
   */
  regenerateAgentToken() {
    return async (request: NextRequest, context: { params: Promise<{ agentId: string }> }): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(request);
        const tenant = apiRequest.context.tenant;
        const { agentId } = await context.params;

        return await runWithTenant(tenant, async () => {
          const knex = await getConnection(tenant);

          const agent = await knex('rd_agents')
            .where({ tenant, agent_id: agentId })
            .first();

          if (!agent) {
            throw new NotFoundError('Agent not found');
          }

          const newToken = `${tenant}:${agentId}:${uuidv4()}`;

          await knex('rd_agents')
            .where({ tenant, agent_id: agentId })
            .update({ connection_token: newToken });

          return createSuccessResponse({ connection_token: newToken });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ========== Enrollment Code APIs ==========

  /**
   * Characters used for enrollment code generation (excludes confusing chars)
   */
  private static ENROLLMENT_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  /**
   * Generate a human-readable enrollment code (ABC-123-XYZ format)
   */
  private generateEnrollmentCode(): string {
    const chars = ApiRemoteDesktopController.ENROLLMENT_CODE_CHARS;
    const segments: string[] = [];

    for (let i = 0; i < 3; i++) {
      let segment = '';
      for (let j = 0; j < 3; j++) {
        segment += chars[crypto.randomInt(chars.length)];
      }
      segments.push(segment);
    }

    return segments.join('-');
  }

  /**
   * Hash an enrollment code for storage
   */
  private hashEnrollmentCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  /**
   * POST /api/v1/remote-desktop/enrollment-codes
   * Generate a new enrollment code
   */
  createEnrollmentCode() {
    return async (request: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(request);
        const tenant = apiRequest.context.tenant;
        const userId = apiRequest.context.userId;
        const body = await request.json();

        const {
          company_id,
          expires_in_hours = 24,
          usage_limit = 1,
          permissions,
        } = body;

        // Validate expires_in_hours
        if (expires_in_hours < 1 || expires_in_hours > 168) { // 1 hour to 7 days
          throw new ValidationError('expires_in_hours must be between 1 and 168');
        }

        // Validate usage_limit
        if (usage_limit < 1 || usage_limit > 100) {
          throw new ValidationError('usage_limit must be between 1 and 100');
        }

        // Validate and sanitize permissions if provided
        let defaultPermissions = DEFAULT_PERMISSIONS;
        if (permissions) {
          const permissionErrors = validatePermissions(permissions);
          if (permissionErrors.length > 0) {
            throw new ValidationError(`Invalid permissions: ${permissionErrors.join(', ')}`);
          }
          defaultPermissions = sanitizePermissions(permissions);
        }

        return await runWithTenant(tenant, async () => {
          const knex = await getConnection(tenant);

          // If company_id provided, verify it exists
          if (company_id) {
            const company = await knex('companies')
              .where({ tenant, company_id })
              .first();
            if (!company) {
              throw new NotFoundError('Company not found');
            }
          }

          const code = this.generateEnrollmentCode();
          const codeHash = this.hashEnrollmentCode(code);
          const expiresAt = new Date(Date.now() + expires_in_hours * 3600 * 1000);

          const [enrollmentCode] = await knex('rd_enrollment_codes')
            .insert({
              tenant,
              company_id: company_id || null,
              code,
              code_hash: codeHash,
              created_by: userId,
              expires_at: expiresAt,
              usage_limit,
              default_permissions: defaultPermissions,
            })
            .returning(['code_id', 'code', 'expires_at', 'usage_limit', 'default_permissions']);

          return createSuccessResponse({
            code_id: enrollmentCode.code_id,
            code: enrollmentCode.code, // Only returned once!
            expires_at: enrollmentCode.expires_at,
            usage_limit: enrollmentCode.usage_limit,
            permissions: enrollmentCode.default_permissions,
          }, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * GET /api/v1/remote-desktop/enrollment-codes
   * List enrollment codes
   */
  listEnrollmentCodes() {
    return async (request: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(request);
        const tenant = apiRequest.context.tenant;

        return await runWithTenant(tenant, async () => {
          const knex = await getConnection(tenant);

          const { searchParams } = new URL(request.url);
          const companyId = searchParams.get('company_id');
          const includeExpired = searchParams.get('include_expired') === 'true';
          const includeRevoked = searchParams.get('include_revoked') === 'true';
          const page = parseInt(searchParams.get('page') || '1');
          const limit = Math.min(parseInt(searchParams.get('limit') || '25'), 100);
          const offset = (page - 1) * limit;

          let query = knex('rd_enrollment_codes')
            .where({ tenant })
            .select([
              'code_id',
              'company_id',
              'created_by',
              'created_at',
              'expires_at',
              'usage_limit',
              'usage_count',
              'default_permissions',
              'revoked_at',
              'revoked_by',
            ])
            .orderBy('created_at', 'desc');

          let countQuery = knex('rd_enrollment_codes')
            .where({ tenant })
            .count('* as count');

          if (companyId) {
            query = query.where({ company_id: companyId });
            countQuery = countQuery.where({ company_id: companyId });
          }

          if (!includeExpired) {
            query = query.where('expires_at', '>', knex.fn.now());
            countQuery = countQuery.where('expires_at', '>', knex.fn.now());
          }

          if (!includeRevoked) {
            query = query.whereNull('revoked_at');
            countQuery = countQuery.whereNull('revoked_at');
          }

          const [codes, countResult] = await Promise.all([
            query.limit(limit).offset(offset),
            countQuery.first(),
          ]);

          const total = parseInt((countResult as any)?.count || '0');

          // Don't return the actual code, just the ID and metadata
          return createPaginatedResponse(codes, total, page, limit);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * DELETE /api/v1/remote-desktop/enrollment-codes/:codeId
   * Revoke an enrollment code
   */
  revokeEnrollmentCode() {
    return async (request: NextRequest, context: { params: Promise<{ codeId: string }> }): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(request);
        const tenant = apiRequest.context.tenant;
        const userId = apiRequest.context.userId;
        const { codeId } = await context.params;

        return await runWithTenant(tenant, async () => {
          const knex = await getConnection(tenant);

          const code = await knex('rd_enrollment_codes')
            .where({ tenant, code_id: codeId })
            .first();

          if (!code) {
            throw new NotFoundError('Enrollment code not found');
          }

          if (code.revoked_at) {
            throw new BadRequestError('Enrollment code already revoked');
          }

          await knex('rd_enrollment_codes')
            .where({ tenant, code_id: codeId })
            .update({
              revoked_at: knex.fn.now(),
              revoked_by: userId,
            });

          return createSuccessResponse({ message: 'Enrollment code revoked' });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ========== Agent Enrollment API ==========

  /**
   * POST /api/v1/remote-desktop/agents/enroll
   * Enroll an agent using an enrollment code (no authentication required)
   */
  enrollAgent() {
    return async (request: NextRequest): Promise<NextResponse> => {
      try {
        const body = await request.json();
        const {
          enrollment_code,
          machine_id,
          hostname,
          os_type,
          os_version,
          agent_version,
        } = body;

        // Validate required fields
        if (!enrollment_code || !machine_id || !hostname || !os_type || !agent_version) {
          throw new ValidationError(
            'Missing required fields: enrollment_code, machine_id, hostname, os_type, agent_version'
          );
        }

        if (os_type !== 'windows' && os_type !== 'macos') {
          throw new ValidationError('Invalid os_type. Must be "windows" or "macos"');
        }

        // Hash the code for lookup
        const codeHash = this.hashEnrollmentCode(enrollment_code);

        // Find and validate the enrollment code
        const knex = await getConnection();

        const enrollmentCode = await knex('rd_enrollment_codes')
          .where({ code_hash: codeHash })
          .where('expires_at', '>', knex.fn.now())
          .whereRaw('usage_count < usage_limit')
          .whereNull('revoked_at')
          .first();

        if (!enrollmentCode) {
          throw new UnauthorizedError('Invalid or expired enrollment code');
        }

        const tenant = enrollmentCode.tenant;

        return await runWithTenant(tenant, async () => {
          const tenantKnex = await getConnection(tenant);

          // Check if agent already exists with this machine_id
          const existingAgent = await tenantKnex('rd_agents')
            .where({ tenant, machine_id })
            .first();

          if (existingAgent) {
            // If already enrolled, return existing agent info
            return createSuccessResponse({
              agent_id: existingAgent.agent_id,
              tenant_id: tenant,
              signaling_server: process.env.SIGNALING_SERVER_URL || '/ws/rd-signal',
              permissions: existingAgent.permissions,
              already_enrolled: true,
            });
          }

          // Generate connection token
          const connectionToken = `${tenant}:${uuidv4()}:${uuidv4()}`;

          // Create agent record
          const [agent] = await tenantKnex('rd_agents')
            .insert({
              tenant,
              agent_name: hostname, // Default to hostname
              hostname,
              os_type,
              os_version,
              company_id: enrollmentCode.company_id,
              agent_version,
              status: 'offline',
              metadata: { machine_id },
              connection_token: connectionToken,
              permissions: enrollmentCode.default_permissions,
              enrolled_with_code_id: enrollmentCode.code_id,
              enrolled_at: tenantKnex.fn.now(),
              machine_id,
              registered_at: tenantKnex.fn.now(),
            })
            .returning(['agent_id', 'permissions']);

          // Increment usage count on enrollment code
          await tenantKnex('rd_enrollment_codes')
            .where({ tenant, code_id: enrollmentCode.code_id })
            .increment('usage_count', 1);

          return createSuccessResponse({
            agent_id: agent.agent_id,
            tenant_id: tenant,
            connection_token: connectionToken,
            signaling_server: process.env.SIGNALING_SERVER_URL || '/ws/rd-signal',
            permissions: agent.permissions,
          }, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}
