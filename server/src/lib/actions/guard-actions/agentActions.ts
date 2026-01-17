'use server';

/**
 * Alga Guard - Agent Registration Server Actions
 *
 * Handles endpoint agent registration, heartbeat, and configuration.
 * (F294: POST /api/agents/register endpoint)
 * (F295: Return AgentConfig on successful registration)
 */

import { createTenantKnex } from '../../db';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import type {
  IAgentRegistrationRequest,
  IAgentRegistrationResponse,
  IAgentConfig,
  IAgentInstalledExtension,
  IAgentHeartbeatRequest,
  IAgentHeartbeatResponse,
  IGuardAgent,
  AgentStatus,
} from '@/interfaces/guard/agent.interfaces';

/**
 * Default poll interval for agents (5 minutes)
 */
const DEFAULT_POLL_INTERVAL_SECONDS = 300;

/**
 * Default scan paths by OS
 */
const DEFAULT_SCAN_PATHS: Record<string, string[]> = {
  windows: ['C:\\Users', 'C:\\ProgramData'],
  macos: ['/Users', '/Volumes'],
  linux: ['/home', '/root'],
};

/**
 * Global exclude patterns
 */
const GLOBAL_EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/vendor/**',
  '**/__pycache__/**',
  '**/Library/Caches/**',
  '**/AppData/Local/Temp/**',
  '**/tmp/**',
];

/**
 * Register a new endpoint agent or update an existing registration
 * (F294, F295)
 */
export async function registerAgent(
  request: IAgentRegistrationRequest,
  tenantId?: string
): Promise<IAgentRegistrationResponse> {
  try {
    const { knex: db } = await createTenantKnex();

    // If no tenant ID provided, try to resolve from registration token
    let resolvedTenantId = tenantId;
    let companyId: string | undefined = request.company_id;

    if (!resolvedTenantId && request.registration_token) {
      // Look up tenant from registration token
      const tokenRecord = await db('guard_agent_registration_tokens')
        .where('token', request.registration_token)
        .where('expires_at', '>', new Date())
        .where('used', false)
        .first();

      if (tokenRecord) {
        resolvedTenantId = tokenRecord.tenant;
        companyId = tokenRecord.company_id;

        // Mark token as used
        await db('guard_agent_registration_tokens')
          .where('id', tokenRecord.id)
          .update({ used: true, used_at: new Date() });
      }
    }

    if (!resolvedTenantId) {
      return {
        success: false,
        error: 'Invalid or missing registration token',
      };
    }

    // Check if agent already exists
    const existingAgent = await db('guard_agents')
      .where('tenant', resolvedTenantId)
      .where('agent_id', request.agent_id)
      .first();

    const now = new Date();

    if (existingAgent) {
      // Update existing agent
      await db('guard_agents')
        .where('id', existingAgent.id)
        .update({
          hostname: request.hostname,
          os: request.os,
          arch: request.arch,
          agent_version: request.agent_version,
          capabilities: JSON.stringify(request.capabilities),
          status: 'active' as AgentStatus,
          last_seen_at: now,
          updated_at: now,
        });
    } else {
      // Create new agent record
      const agentId = uuidv4();

      await db('guard_agents').insert({
        id: agentId,
        tenant: resolvedTenantId,
        agent_id: request.agent_id,
        company_id: companyId || null,
        hostname: request.hostname,
        os: request.os,
        arch: request.arch,
        agent_version: request.agent_version,
        capabilities: JSON.stringify(request.capabilities),
        status: 'active' as AgentStatus,
        last_seen_at: now,
        registered_at: now,
        created_at: now,
        updated_at: now,
      });
    }

    // Build agent configuration
    const config = await buildAgentConfig(
      db,
      resolvedTenantId,
      request.agent_id,
      companyId || '',
      request.os
    );

    return {
      success: true,
      config,
    };
  } catch (error) {
    console.error('Agent registration failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Registration failed',
    };
  }
}

/**
 * Handle agent heartbeat
 */
export async function agentHeartbeat(
  request: IAgentHeartbeatRequest,
  tenantId: string
): Promise<IAgentHeartbeatResponse> {
  try {
    const { knex: db } = await createTenantKnex();

    // Update agent status
    const result = await db('guard_agents')
      .where('tenant', tenantId)
      .where('agent_id', request.agent_id)
      .update({
        status: request.status,
        last_seen_at: new Date(),
        updated_at: new Date(),
      });

    if (result === 0) {
      return {
        success: false,
      };
    }

    // Check for pending commands
    const pendingCommands = await db('guard_agent_commands')
      .where('tenant', tenantId)
      .where('agent_id', request.agent_id)
      .where('status', 'pending')
      .orderBy('created_at', 'asc')
      .limit(10);

    // Mark commands as dispatched
    if (pendingCommands.length > 0) {
      const commandIds = pendingCommands.map((c: { id: string }) => c.id);
      await db('guard_agent_commands')
        .whereIn('id', commandIds)
        .update({ status: 'dispatched', dispatched_at: new Date() });
    }

    // Check for extension updates
    const agent = await db('guard_agents')
      .where('tenant', tenantId)
      .where('agent_id', request.agent_id)
      .first();

    let extensionUpdates: IAgentInstalledExtension[] | undefined;

    if (agent?.company_id) {
      // Get installed extensions for this company
      extensionUpdates = await getInstalledExtensions(
        db,
        tenantId,
        agent.company_id
      );
    }

    return {
      success: true,
      pending_commands: pendingCommands.map((c: {
        id: string;
        command_type: 'trigger_scan' | 'update_extension' | 'restart' | 'uninstall_extension';
        payload: Record<string, unknown>;
      }) => ({
        command_id: c.id,
        type: c.command_type,
        payload: c.payload || {},
      })),
      extension_updates: extensionUpdates,
    };
  } catch (error) {
    console.error('Agent heartbeat failed:', error);
    return {
      success: false,
    };
  }
}

/**
 * Get an agent by ID
 */
export async function getAgent(
  agentId: string,
  tenantId: string
): Promise<IGuardAgent | null> {
  try {
    const { knex: db } = await createTenantKnex();

    const agent = await db('guard_agents')
      .where('tenant', tenantId)
      .where('agent_id', agentId)
      .first();

    if (!agent) {
      return null;
    }

    return {
      ...agent,
      capabilities:
        typeof agent.capabilities === 'string'
          ? JSON.parse(agent.capabilities)
          : agent.capabilities,
    };
  } catch (error) {
    console.error('Get agent failed:', error);
    return null;
  }
}

/**
 * List agents for a tenant
 */
export async function getAgents(
  tenantId: string,
  options: {
    company_id?: string;
    status?: AgentStatus;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<{ agents: IGuardAgent[]; total: number }> {
  try {
    const { knex: db } = await createTenantKnex();
    const { company_id, status, page = 1, pageSize = 25 } = options;

    let query = db('guard_agents').where('tenant', tenantId);

    if (company_id) {
      query = query.where('company_id', company_id);
    }

    if (status) {
      query = query.where('status', status);
    }

    // Get total count
    const countResult = await query.clone().count('* as count').first();
    const total = Number(countResult?.count || 0);

    // Get paginated results
    const agents = await query
      .orderBy('last_seen_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      agents: agents.map((a: Record<string, unknown>) => ({
        ...a,
        capabilities:
          typeof a.capabilities === 'string'
            ? JSON.parse(a.capabilities as string)
            : a.capabilities,
      })) as IGuardAgent[],
      total,
    };
  } catch (error) {
    console.error('Get agents failed:', error);
    return { agents: [], total: 0 };
  }
}

/**
 * Create a registration token for agent enrollment
 */
export async function createRegistrationToken(
  tenantId: string,
  companyId: string,
  expiresInHours: number = 24
): Promise<{ token: string; expires_at: Date }> {
  const { knex: db } = await createTenantKnex();

  const token = uuidv4();
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  await db('guard_agent_registration_tokens').insert({
    id: uuidv4(),
    tenant: tenantId,
    company_id: companyId,
    token,
    expires_at: expiresAt,
    used: false,
    created_at: new Date(),
  });

  return {
    token,
    expires_at: expiresAt,
  };
}

/**
 * Queue a command for an agent
 */
export async function queueAgentCommand(
  tenantId: string,
  agentId: string,
  commandType: 'trigger_scan' | 'update_extension' | 'restart' | 'uninstall_extension',
  payload: Record<string, unknown> = {}
): Promise<string> {
  const { knex: db } = await createTenantKnex();

  const commandId = uuidv4();

  await db('guard_agent_commands').insert({
    id: commandId,
    tenant: tenantId,
    agent_id: agentId,
    command_type: commandType,
    payload: JSON.stringify(payload),
    status: 'pending',
    created_at: new Date(),
  });

  return commandId;
}

/**
 * Build agent configuration (F295)
 */
async function buildAgentConfig(
  db: Knex,
  tenantId: string,
  agentId: string,
  companyId: string,
  os: string
): Promise<IAgentConfig> {
  // Get installed extensions
  const installedExtensions = companyId
    ? await getInstalledExtensions(db, tenantId, companyId)
    : [];

  // Get scan paths for this OS
  const scanPaths = DEFAULT_SCAN_PATHS[os] || DEFAULT_SCAN_PATHS.linux;

  return {
    tenant_id: tenantId,
    company_id: companyId,
    agent_id: agentId,
    poll_interval_seconds: DEFAULT_POLL_INTERVAL_SECONDS,
    extension_base_url: process.env.EXTENSION_BASE_URL || '/api/ext',
    installed_extensions: installedExtensions,
    logging: {
      level: 'info',
      remote_logging: true,
      remote_logging_endpoint: '/api/guard/agents/logs',
      max_log_file_mb: 10,
    },
    scan_paths: {
      default_paths: scanPaths,
      exclude_patterns: GLOBAL_EXCLUDE_PATTERNS,
    },
  };
}

/**
 * Get installed extensions for an agent
 */
async function getInstalledExtensions(
  db: Knex,
  tenantId: string,
  _companyId: string
): Promise<IAgentInstalledExtension[]> {
  // Get extensions installed for this tenant/company that should run on agents
  const extensions = await db('tenant_extension_install')
    .join('extensions', 'tenant_extension_install.extension_id', 'extensions.extension_id')
    .where('tenant_extension_install.tenant', tenantId)
    .where('extensions.runner_type', 'endpoint_agent')
    .select(
      'extensions.extension_id',
      'extensions.version',
      'tenant_extension_install.config',
      'extensions.bundle_hash as content_hash'
    );

  return extensions.map((ext: {
    extension_id: string;
    version: string;
    content_hash: string;
  }) => ({
    extension_id: ext.extension_id,
    version: ext.version,
    content_hash: ext.content_hash || '',
    download_url: `/api/ext/${ext.extension_id}/bundle`,
  }));
}
