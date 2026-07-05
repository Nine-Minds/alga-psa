import crypto from 'node:crypto';
import { tenantDb } from '@alga-psa/db';
import { createTenantKnex, runWithTenant } from '@/lib/db';
import { getConnection } from '@/lib/db/db';
import { resolveIdpFromPreset, type IdpKind } from './idpPresets';
import { listBuiltinIssuers } from './idpBuiltins';

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
  subject_claim: string;
  kind: IdpKind;
  entra_tenant_id: string | null;
  active: boolean;
}

/**
 * Thrown when an agent would bind to an (issuer, subject) already claimed by an
 * active agent. The route maps `.name` to HTTP 409 (the seam erases the class
 * identity, so callers match on the string name, not `instanceof`).
 */
export class AgentBindingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentBindingConflictError';
  }
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
  // One agent per IdP identity: validation resolves (issuer, subject) -> agent
  // cross-tenant, so a second binding to the same identity would be ambiguous.
  // Reject it up front with a friendly message instead of a silent shadow.
  if (input.idpIssuer && input.idpSubject) {
    const existing = await resolveAgentByIdp(input.idpIssuer, input.idpSubject);
    if (existing) {
      throw new AgentBindingConflictError(
        `An active agent ("${existing.agent.name}") is already bound to ${input.idpIssuer} / ${input.idpSubject}. ` +
          'Each IdP identity maps to one agent — deactivate that agent or use a different subject.',
      );
    }
  }
  return runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex(tenant);
    const agentId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const slug = agentId.slice(0, 8);
    const roleIds = Array.from(new Set((input.roleIds ?? []).filter((r) => typeof r === 'string' && r)));

    return knex.transaction(async (trx) => {
      const db = tenantDb(trx, tenant);

      await db.table('users').insert({
        user_id: userId,
        tenant,
        username: `mcp-agent-${slug}`,
        email: `mcp-agent-${agentId}@agents.alga.local`,
        hashed_password: lockedPassword(),
        user_type: 'internal',
      });

      for (const roleId of roleIds) {
        await db.table('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
        await db.table('agent_roles').insert({ tenant, agent_id: agentId, role_id: roleId });
      }

      const [agent] = await db.table('agents')
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
    return tenantDb(knex, tenant).table('agents').orderBy('created_at', 'desc');
  });
}

export async function setAgentActive(tenant: string, agentId: string, active: boolean): Promise<void> {
  await runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex(tenant);
    await tenantDb(knex, tenant).table('agents').where({ agent_id: agentId }).update({ active, updated_at: knex.fn.now() });
  });
}

/**
 * Permanently remove an agent and everything provisioned for it. There are no DB
 * cascades (tenant isolation + relations are app-enforced), so we tear down each
 * relation explicitly in one transaction: role grants, the audit trail, any
 * agent-scoped API keys, and the backing internal user. Idempotent.
 */
export async function deleteAgent(tenant: string, agentId: string): Promise<void> {
  await runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex(tenant);
    const agent = (await tenantDb(knex, tenant).table('agents').where({ agent_id: agentId }).first()) as AgentRecord | undefined;
    if (!agent) return;
    const userId = backingUserId(agent);
    await knex.transaction(async (trx) => {
      const db = tenantDb(trx, tenant);
      await db.table('agent_roles').where({ agent_id: agentId }).del();
      await db.table('mcp_agent_audit').where({ agent_id: agentId }).del();
      await db.table('api_keys').where({ agent_id: agentId }).del();
      if (userId) {
        await db.table('user_roles').where({ user_id: userId }).del();
        await db.table('users').where({ user_id: userId }).del();
      }
      await db.table('agents').where({ agent_id: agentId }).del();
    });
  });
}

export interface TrustedIdpInput {
  tenant: string;
  /** Preset: 'google' | 'microsoft' | 'custom' (default 'custom'). */
  kind?: IdpKind;
  /** Microsoft preset: the customer's Entra tenant id. */
  entraTenantId?: string;
  /** Custom: raw issuer + JWKS. For presets these are derived via discovery. */
  issuer?: string;
  jwksUri?: string;
  audience?: string;
  /** Which token claim identifies the agent (sub / azp / client_id). Preset-defaulted. */
  subjectClaim?: string;
  /** Test/seam override of the discovery origin. */
  discoveryBaseUrl?: string;
}

/** Add/update a trusted IdP, resolving presets (issuer + JWKS via OIDC discovery). Returns the stored row. */
export async function addTrustedIdp(input: TrustedIdpInput): Promise<TrustedIdp> {
  const kind = input.kind ?? 'custom';
  const resolved = await resolveIdpFromPreset(kind, {
    entraTenantId: input.entraTenantId,
    issuer: input.issuer,
    jwksUri: input.jwksUri,
    subjectClaim: input.subjectClaim,
    discoveryBaseUrl: input.discoveryBaseUrl,
  });
  return runWithTenant(input.tenant, async () => {
    const { knex } = await createTenantKnex(input.tenant);
    const db = tenantDb(knex, input.tenant);
    const fields = {
      jwks_uri: resolved.jwksUri,
      audience: input.audience ?? null,
      subject_claim: resolved.subjectClaim,
      kind,
      entra_tenant_id: input.entraTenantId ?? null,
    };
    await db.table('agent_idp_providers')
      .insert({ tenant: input.tenant, issuer: resolved.issuer, ...fields })
      .onConflict(['tenant', 'issuer'])
      .merge({ ...fields, active: true, updated_at: new Date().toISOString() });
    return db.table('agent_idp_providers').where({ issuer: resolved.issuer }).first();
  });
}

/** Cross-tenant (admin connection, RLS-bypassing) lookup of trusted IdPs by issuer. */
export async function findTrustedIdpsByIssuer(issuer: string): Promise<TrustedIdp[]> {
  const knex = await getConnection(null);
  return tenantDb(knex, '__mcp_trusted_idp_issuer_discovery__')
    .unscoped('agent_idp_providers', 'MCP trusted IdP lookup resolves issuer registrations across tenants')
    .where({ issuer, active: true });
}

/** Distinct active issuers across the instance (for the Protected Resource Metadata doc). */
export async function listAllActiveIssuers(): Promise<string[]> {
  const knex = await getConnection(null);
  const rows = await tenantDb(knex, '__mcp_trusted_idp_issuer_listing__')
    .unscoped('agent_idp_providers', 'MCP protected resource metadata lists active issuers across tenants')
    .where({ active: true })
    .distinct('issuer');
  const registered = rows.map((r: { issuer: string }) => r.issuer);
  // Advertise hosted built-ins (Google/Microsoft shared apps) when enabled, so
  // MCP clients can discover them via Protected Resource Metadata with no per-
  // tenant IdP registration.
  const builtins = await listBuiltinIssuers();
  return Array.from(new Set([...registered, ...builtins]));
}

export async function listTrustedIdps(tenant: string): Promise<TrustedIdp[]> {
  return runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex(tenant);
    return tenantDb(knex, tenant).table('agent_idp_providers').orderBy('issuer');
  });
}

export interface IdpSuggestion {
  microsoft?: { entraTenantId: string; displayName: string | null; source: string };
}

/**
 * Reuse an existing connection (F008): if the tenant already linked Microsoft
 * (SSO / email / Teams) we know their Entra tenant id, so the agent IdP can be
 * pre-filled — "you're already connected to Microsoft".
 */
export async function getIdpSuggestions(tenant: string): Promise<IdpSuggestion> {
  return runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex(tenant);
    const hasProfiles = await knex.schema.hasTable('microsoft_profiles');
    if (hasProfiles) {
      const prof = await tenantDb(knex, tenant)
        .table('microsoft_profiles')
        .where({ is_archived: false })
        .whereNotNull('tenant_id')
        .orderBy('is_default', 'desc')
        .first();
      if (prof?.tenant_id) {
        return { microsoft: { entraTenantId: prof.tenant_id, displayName: prof.display_name ?? null, source: 'microsoft_profile' } };
      }
    }
    return {};
  });
}

/** Cross-tenant resolve of an agent by its IdP (issuer, subject) binding. */
export async function resolveAgentByIdp(issuer: string, subject: string): Promise<ResolvedAgent | null> {
  const knex = await getConnection(null);
  const agent = (await tenantDb(knex, '__mcp_agent_idp_resolution__')
    .unscoped('agents', 'MCP agent token validation resolves IdP binding across tenants')
    .where({ idp_issuer: issuer, idp_subject: subject, active: true })
    .first()) as AgentRecord | undefined;
  if (!agent) return null;
  return { agent, tenant: agent.tenant, backingUserId: backingUserId(agent) };
}

export async function getAgentRoleIds(tenant: string, agentId: string): Promise<string[]> {
  return runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex(tenant);
    const rows = await tenantDb(knex, tenant).table('agent_roles').where({ agent_id: agentId }).select('role_id');
    return rows.map((r: { role_id: string }) => r.role_id);
  });
}

export interface AssignableRole {
  role_id: string;
  role_name: string;
  description: string | null;
}

/** MSP (internal) roles assignable to an agent. */
export async function listAssignableRoles(tenant: string): Promise<AssignableRole[]> {
  return runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex(tenant);
    return tenantDb(knex, tenant).table('roles')
      .where({ msp: true })
      .select('role_id', 'role_name', 'description')
      .orderBy('role_name');
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
    const db = tenantDb(knex, tenant);
    // Opportunistically sweep this tenant's expired agent session keys so they
    // don't accumulate (each agent request mints a fresh short-lived key).
    await db.table('api_keys')
      .where({ purpose: 'mcp_agent' })
      .whereNotNull('expires_at')
      .where('expires_at', '<', knex.fn.now())
      .del();
    await db.table('api_keys').insert({
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

/** Delete all expired agent session keys across all tenants (for a sweep job). */
export async function cleanupExpiredAgentKeys(): Promise<number> {
  const knex = await getConnection(null);
  return tenantDb(knex, '__mcp_expired_agent_key_cleanup__')
    .unscoped('api_keys', 'MCP expired agent session key sweep deletes expired keys across all tenants')
    .where({ purpose: 'mcp_agent' })
    .whereNotNull('expires_at')
    .where('expires_at', '<', knex.fn.now())
    .del();
}
