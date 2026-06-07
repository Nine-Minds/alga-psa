import crypto from 'node:crypto';
import { createTenantKnex, runWithTenant } from '../db';
import { getConnection } from '../db/db';

/**
 * MCP agent identity service (Phase 2). An agent is a first-class principal
 * bound to a tenant-IdP subject. RBAC is reused by backing each agent with a
 * dedicated, no-login internal user (so the existing kernel/hasPermission path
 * enforces the agent's assigned roles). See design.md §10.
 */

export interface AgentRecord {
  agent_id: string;
  tenant: string;
  name: string;
  description: string | null;
  idp_issuer: string | null;
  idp_subject: string | null;
  active: boolean;
  created_by: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentInput {
  tenant: string;
  name: string;
  description?: string;
  idpIssuer?: string;
  idpSubject?: string;
  roleIds?: string[];
  createdBy?: string;
}

export interface ResolvedAgent {
  agent: AgentRecord;
  tenant: string;
  backingUserId: string | null;
}

export interface TrustedIdp {
  tenant: string;
  issuer: string;
  jwks_uri: string;
  audience: string | null;
  active: boolean;
}

function lockedPassword(): string {
  // Agents authenticate via IdP token, never password. This is unguessable and
  // not a usable bcrypt hash, so credential login can never succeed.
  return `!mcp-agent-no-login!${crypto.randomBytes(24).toString('hex')}`;
}

function backingUserId(agent: AgentRecord): string | null {
  const id = agent.metadata && (agent.metadata as Record<string, unknown>).backing_user_id;
  return typeof id === 'string' ? id : null;
}

export async function createAgent(input: CreateAgentInput): Promise<AgentRecord> {
  const { tenant } = input;
  return runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex(tenant);
    const agentId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const slug = agentId.slice(0, 8);
    const roleIds = Array.from(new Set((input.roleIds ?? []).filter((r) => typeof r === 'string' && r)));

    return knex.transaction(async (trx) => {
      await trx('users').insert({
        user_id: userId,
        tenant,
        username: `mcp-agent-${slug}`,
        email: `mcp-agent-${agentId}@agents.alga.local`,
        hashed_password: lockedPassword(),
        user_type: 'internal',
      });

      for (const roleId of roleIds) {
        await trx('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
        await trx('agent_roles').insert({ tenant, agent_id: agentId, role_id: roleId });
      }

      const [agent] = await trx('agents')
        .insert({
          agent_id: agentId,
          tenant,
          name: input.name,
          description: input.description ?? null,
          idp_issuer: input.idpIssuer ?? null,
          idp_subject: input.idpSubject ?? null,
          active: true,
          created_by: input.createdBy ?? null,
          metadata: JSON.stringify({ backing_user_id: userId }),
        })
        .returning('*');
      return agent as AgentRecord;
    });
  });
}

export async function listAgents(tenant: string): Promise<AgentRecord[]> {
  return runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex(tenant);
    return knex('agents').where({ tenant }).orderBy('created_at', 'desc');
  });
}

export async function setAgentActive(tenant: string, agentId: string, active: boolean): Promise<void> {
  await runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex(tenant);
    await knex('agents').where({ tenant, agent_id: agentId }).update({ active, updated_at: knex.fn.now() });
  });
}

export interface TrustedIdpInput {
  tenant: string;
  issuer: string;
  jwksUri: string;
  audience?: string;
}

export async function addTrustedIdp(input: TrustedIdpInput): Promise<void> {
  await runWithTenant(input.tenant, async () => {
    const { knex } = await createTenantKnex(input.tenant);
    await knex('agent_idp_providers')
      .insert({
        tenant: input.tenant,
        issuer: input.issuer,
        jwks_uri: input.jwksUri,
        audience: input.audience ?? null,
      })
      .onConflict(['tenant', 'issuer'])
      .merge({ jwks_uri: input.jwksUri, audience: input.audience ?? null, active: true, updated_at: knex.fn.now() });
  });
}

/** Cross-tenant (admin connection, RLS-bypassing) lookup of trusted IdPs by issuer. */
export async function findTrustedIdpsByIssuer(issuer: string): Promise<TrustedIdp[]> {
  const knex = await getConnection(null);
  return knex('agent_idp_providers').where({ issuer, active: true });
}

/** Cross-tenant resolve of an agent by its IdP (issuer, subject) binding. */
export async function resolveAgentByIdp(issuer: string, subject: string): Promise<ResolvedAgent | null> {
  const knex = await getConnection(null);
  const agent = (await knex('agents')
    .where({ idp_issuer: issuer, idp_subject: subject, active: true })
    .first()) as AgentRecord | undefined;
  if (!agent) return null;
  return { agent, tenant: agent.tenant, backingUserId: backingUserId(agent) };
}

export async function getAgentRoleIds(tenant: string, agentId: string): Promise<string[]> {
  return runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex(tenant);
    const rows = await knex('agent_roles').where({ tenant, agent_id: agentId }).select('role_id');
    return rows.map((r: { role_id: string }) => r.role_id);
  });
}

/**
 * Mint a short-lived agent-scoped API key (backed by the agent's internal user)
 * for dispatching tool calls through /api/v1 under the agent's permissions.
 * Returns the plaintext token.
 */
export async function mintAgentSessionKey(params: {
  tenant: string;
  agentId: string;
  backingUserId: string;
  ttlSeconds?: number;
}): Promise<string> {
  const { tenant, agentId, backingUserId: userId } = params;
  const ttl = params.ttlSeconds ?? 300;
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex(tenant);
    await knex('api_keys').insert({
      api_key: hash,
      user_id: userId,
      agent_id: agentId,
      tenant,
      description: `mcp-agent-session:${agentId}`,
      purpose: 'mcp_agent',
      active: true,
      usage_limit: null,
      expires_at: knex.raw(`now() + (? * interval '1 second')`, [ttl]),
    });
  });
  return token;
}
