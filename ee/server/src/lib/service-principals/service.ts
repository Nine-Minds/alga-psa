import crypto from 'node:crypto';
import type { Knex } from 'knex';
import { servicePrincipalDb as tenantDb } from './tables';
import { TIER_FEATURES } from '@alga-psa/types';
import { assertTenantTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import {
  assertServicePrincipalLimit,
  rateLimitCeiling,
} from './entitlements';

/**
 * Service-principal service (PRD R1.5, R6, R8). Every function takes the knex
 * (or transaction) it runs on so callers - server actions, the MCP agent layer
 * and tests - choose the transaction boundary. Tier checks (R6.0) run before the
 * write transaction opens (they read admin state); the limit check (R6.3) runs
 * inside it, serialized per tenant by an advisory lock so two concurrent creates
 * cannot both take the last slot.
 */

export type ServicePrincipalKind = 'api' | 'mcp_agent';

export interface ServicePrincipalRecord {
  tenant: string;
  user_id: string;
  kind: ServicePrincipalKind;
  name: string;
  description: string | null;
  allow_act_as: boolean;
  rate_limit_max_tokens: number | null;
  rate_limit_refill_per_min: number | null;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServicePrincipalListItem extends ServicePrincipalRecord {
  is_inactive: boolean;
  active_key_count: number;
  roles: { role_id: string; role_name: string }[];
  /** max(api_keys.last_used_at) across every key the principal owns, or null if never used. */
  last_used_at: string | null;
}

export class ServicePrincipalError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.name = 'ServicePrincipalError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const notFound = () => new ServicePrincipalError('SERVICE_PRINCIPAL_NOT_FOUND', 'Service principal not found', 404);

function lockedPassword(): string {
  // Principals authenticate by key or IdP token, never by password. Not a usable
  // bcrypt hash, so credential login can never succeed.
  return `!service-principal-no-login!${crypto.randomBytes(24).toString('hex')}`;
}

export async function assertServicePrincipalTier(tenant: string): Promise<void> {
  await assertTenantTierAccess(tenant, TIER_FEATURES.SERVICE_PRINCIPALS);
}

/** Serializes limit-checked writes for one tenant for the life of the transaction. */
async function lockTenantPrincipals(trx: Knex.Transaction, tenant: string): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`service_principals:${tenant}`]);
}

function validateRateLimit(maxTokens: number | null | undefined, refillPerMin: number | null | undefined): void {
  const ceiling = rateLimitCeiling();
  const check = (value: number | null | undefined, max: number, label: string) => {
    if (value === null || value === undefined) return;
    if (!Number.isInteger(value) || value < 1) {
      throw new ServicePrincipalError('RATE_LIMIT_INVALID', `${label} must be a positive whole number`, 400);
    }
    if (value > max) {
      throw new ServicePrincipalError('RATE_LIMIT_ABOVE_CEILING', `${label} cannot exceed ${max}`, 400);
    }
  };
  check(maxTokens, ceiling.maxTokens, 'Burst limit');
  check(refillPerMin, ceiling.refillPerMin, 'Requests per minute');
  if ((maxTokens === null || maxTokens === undefined) !== (refillPerMin === null || refillPerMin === undefined)) {
    throw new ServicePrincipalError(
      'RATE_LIMIT_INVALID',
      'Set both the burst limit and the requests per minute, or neither',
      400,
    );
  }
}

/** Dedupes and validates role ids: tenant-scoped, MSP roles only (R2.6). Returns the clean list. */
async function validateMspRoleIds(
  db: ReturnType<typeof tenantDb>,
  rawRoleIds: string[] | undefined,
): Promise<string[]> {
  const roleIds = Array.from(new Set((rawRoleIds ?? []).filter((r) => typeof r === 'string' && r)));
  if (roleIds.length > 0) {
    const valid = await db.table('roles').whereIn('role_id', roleIds).where({ msp: true }).pluck('role_id');
    const invalid = roleIds.filter((r) => !valid.includes(r));
    if (invalid.length > 0) {
      throw new ServicePrincipalError('SERVICE_PRINCIPAL_ROLE_INVALID', 'Only MSP roles can be assigned', 422);
    }
  }
  return roleIds;
}

export interface CreateServicePrincipalInput {
  kind: ServicePrincipalKind;
  name: string;
  description?: string | null;
  allowActAs?: boolean;
  roleIds?: string[];
  createdBy?: string | null;
  rateLimitMaxTokens?: number | null;
  rateLimitRefillPerMin?: number | null;
  /** Pre-generated id so a caller (createAgent) can bind its own rows to it. */
  userId?: string;
}

/**
 * Creates the service user + metadata row inside `trx`. The caller must have run
 * assertServicePrincipalTier(tenant) before opening `trx`.
 */
export async function createServicePrincipalInTrx(
  trx: Knex.Transaction,
  tenant: string,
  input: CreateServicePrincipalInput,
): Promise<ServicePrincipalRecord> {
  const name = input.name?.trim();
  if (!name) throw new ServicePrincipalError('SERVICE_PRINCIPAL_NAME_REQUIRED', 'A name is required', 400);
  validateRateLimit(input.rateLimitMaxTokens, input.rateLimitRefillPerMin);

  await lockTenantPrincipals(trx, tenant);
  await assertServicePrincipalLimit(trx, tenant);

  const db = tenantDb(trx, tenant);
  const userId = input.userId ?? crypto.randomUUID();
  const slug = userId.slice(0, 8);

  await db.table('users').insert({
    user_id: userId,
    tenant,
    username: `svc-${slug}`,
    email: `svc-${userId}@service.alga.local`,
    first_name: name,
    hashed_password: lockedPassword(),
    user_type: 'service',
    is_inactive: false,
  });

  const roleIds = await validateMspRoleIds(db, input.roleIds);
  for (const roleId of roleIds) {
    await db.table('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
  }

  if (input.allowActAs) await assertServicePrincipalTier(tenant);

  const [record] = await db
    .table('service_principals')
    .insert({
      tenant,
      user_id: userId,
      kind: input.kind,
      name,
      description: input.description ?? null,
      allow_act_as: Boolean(input.allowActAs),
      rate_limit_max_tokens: input.rateLimitMaxTokens ?? null,
      rate_limit_refill_per_min: input.rateLimitRefillPerMin ?? null,
      created_by: input.createdBy ?? null,
    })
    .returning('*');
  return record as ServicePrincipalRecord;
}

export async function createServicePrincipal(
  knex: Knex,
  tenant: string,
  input: CreateServicePrincipalInput,
): Promise<ServicePrincipalRecord> {
  await assertServicePrincipalTier(tenant);
  return knex.transaction((trx) => createServicePrincipalInTrx(trx, tenant, input));
}

async function loadPrincipal(
  conn: Knex | Knex.Transaction,
  tenant: string,
  userId: string,
): Promise<ServicePrincipalRecord> {
  const record = await tenantDb(conn, tenant).table('service_principals').where({ user_id: userId }).first();
  if (!record) throw notFound();
  return record as ServicePrincipalRecord;
}

export async function getServicePrincipal(
  knex: Knex | Knex.Transaction,
  tenant: string,
  userId: string,
): Promise<ServicePrincipalListItem> {
  const record = await loadPrincipal(knex, tenant, userId);
  const [item] = await decorateServicePrincipals(knex, tenant, [record]);
  return item;
}

/** Lists non-archived principals (archived ones are hidden, R8.3). */
export async function listServicePrincipals(
  knex: Knex | Knex.Transaction,
  tenant: string,
): Promise<ServicePrincipalListItem[]> {
  const db = tenantDb(knex, tenant);
  const records = (await db
    .table('service_principals')
    .whereNull('archived_at')
    .orderBy('created_at', 'desc')) as ServicePrincipalRecord[];
  if (records.length === 0) return [];
  return decorateServicePrincipals(knex, tenant, records);
}

/** Adds status, key counts, roles and last-used to principal rows with one batched query each. */
async function decorateServicePrincipals(
  knex: Knex | Knex.Transaction,
  tenant: string,
  records: ServicePrincipalRecord[],
): Promise<ServicePrincipalListItem[]> {
  const db = tenantDb(knex, tenant);
  const ids = records.map((r) => r.user_id);
  const users = await db.table('users').whereIn('user_id', ids).select('user_id', 'is_inactive');
  const keys = await db
    .table('api_keys')
    .whereIn('user_id', ids)
    .where({ active: true })
    .groupBy('user_id')
    .select('user_id')
    .count('* as count');
  const inactive = new Map(users.map((u: { user_id: string; is_inactive: boolean }) => [u.user_id, u.is_inactive]));
  const keyCounts = new Map(keys.map((k: { user_id: string; count: string }) => [k.user_id, parseInt(k.count, 10)]));

  const lastUsedRows = await db
    .table('api_keys')
    .whereIn('user_id', ids)
    .groupBy('user_id')
    .select('user_id')
    .max('last_used_at as last_used_at');
  const lastUsed = new Map(
    lastUsedRows.map((k: { user_id: string; last_used_at: string | Date | null }) => [k.user_id, k.last_used_at]),
  );

  const roleRows = await db
    .table('user_roles')
    .join('roles', function () {
      this.on('roles.role_id', 'user_roles.role_id').andOn('roles.tenant', 'user_roles.tenant');
    })
    .whereIn('user_roles.user_id', ids)
    .orderBy('roles.role_name')
    .select('user_roles.user_id as user_id', 'roles.role_id as role_id', 'roles.role_name as role_name');
  const rolesByUser = new Map<string, { role_id: string; role_name: string }[]>();
  for (const row of roleRows as Array<{ user_id: string; role_id: string; role_name: string }>) {
    const list = rolesByUser.get(row.user_id) ?? [];
    list.push({ role_id: row.role_id, role_name: row.role_name });
    rolesByUser.set(row.user_id, list);
  }

  return records.map((r) => {
    const used = lastUsed.get(r.user_id);
    return {
      ...r,
      is_inactive: Boolean(inactive.get(r.user_id)),
      active_key_count: keyCounts.get(r.user_id) ?? 0,
      roles: rolesByUser.get(r.user_id) ?? [],
      last_used_at: used ? (used instanceof Date ? used.toISOString() : String(used)) : null,
    };
  });
}

export interface UpdateServicePrincipalInput {
  name?: string;
  description?: string | null;
  allowActAs?: boolean;
  /** MSP role ids. When present (even empty) the principal's roles are replaced by exactly this set. */
  roleIds?: string[];
  /** Pass `null` for both to clear the override and fall back to the Pro default. */
  rateLimitMaxTokens?: number | null;
  rateLimitRefillPerMin?: number | null;
}

export async function updateServicePrincipal(
  knex: Knex,
  tenant: string,
  userId: string,
  input: UpdateServicePrincipalInput,
): Promise<ServicePrincipalRecord> {
  const existing = await loadPrincipal(knex, tenant, userId);
  if (existing.archived_at) throw notFound();

  const patch: Record<string, unknown> = { updated_at: knex.fn.now() };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new ServicePrincipalError('SERVICE_PRINCIPAL_NAME_REQUIRED', 'A name is required', 400);
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description;
  if (input.allowActAs !== undefined) {
    // Turning act-as ON is new capability and needs Pro; turning it off never does.
    if (input.allowActAs && !existing.allow_act_as) await assertServicePrincipalTier(tenant);
    patch.allow_act_as = input.allowActAs;
  }
  if ('rateLimitMaxTokens' in input || 'rateLimitRefillPerMin' in input) {
    validateRateLimit(input.rateLimitMaxTokens, input.rateLimitRefillPerMin);
    patch.rate_limit_max_tokens = input.rateLimitMaxTokens ?? null;
    patch.rate_limit_refill_per_min = input.rateLimitRefillPerMin ?? null;
  }

  return knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);
    if (input.roleIds !== undefined) {
      const roleIds = await validateMspRoleIds(db, input.roleIds);
      await db.table('user_roles').where({ user_id: userId }).del();
      for (const roleId of roleIds) {
        await db.table('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
      }
      if (existing.kind === 'mcp_agent') {
        const agent = await db.table('agents').where({ service_user_id: userId }).first('agent_id');
        if (agent) {
          await db.table('agent_roles').where({ agent_id: agent.agent_id }).del();
          for (const roleId of roleIds) {
            await db.table('agent_roles').insert({ tenant, agent_id: agent.agent_id, role_id: roleId });
          }
        }
      }
    }
    const [record] = await db.table('service_principals').where({ user_id: userId }).update(patch).returning('*');
    if (patch.name !== undefined) {
      await db.table('users').where({ user_id: userId }).update({ first_name: patch.name });
      if (existing.kind === 'mcp_agent') {
        await db.table('agents').where({ service_user_id: userId }).update({ name: patch.name, updated_at: trx.fn.now() });
      }
    }
    return record as ServicePrincipalRecord;
  });
}

/**
 * R8.2. Deactivation sets users.is_inactive (and agents.active for MCP agents)
 * and deactivates every active key the principal owns, including outstanding
 * mcp_agent session keys, in one transaction. Reactivation is Pro-gated and
 * limit-checked, reverses the flags and does NOT revive keys.
 */
export async function setServicePrincipalActive(
  knex: Knex,
  tenant: string,
  userId: string,
  active: boolean,
): Promise<void> {
  const existing = await loadPrincipal(knex, tenant, userId);
  if (existing.archived_at) throw notFound();
  if (active) await assertServicePrincipalTier(tenant);

  await knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);
    if (active) {
      await lockTenantPrincipals(trx, tenant);
      const user = await db.table('users').where({ user_id: userId }).first('is_inactive');
      if (user?.is_inactive) await assertServicePrincipalLimit(trx, tenant);
    }
    await db.table('users').where({ user_id: userId }).update({ is_inactive: !active });
    if (existing.kind === 'mcp_agent') {
      await db.table('agents').where({ service_user_id: userId }).update({ active, updated_at: trx.fn.now() });
    }
    if (!active) {
      await db.table('api_keys').where({ user_id: userId, active: true }).update({ active: false, updated_at: trx.fn.now() });
    }
    await db.table('service_principals').where({ user_id: userId }).update({ updated_at: trx.fn.now() });
  });
}

// Columns that may reference a user without a database foreign key (or with a
// cascade that would silently drop history). Together with a savepointed delete
// that surfaces real FK references, this decides archive vs hard delete.
const NON_FK_REFERENCES: Array<[table: string, column: string]> = [
  ['tickets', 'entered_by'],
  ['tickets', 'updated_by'],
  ['tickets', 'closed_by'],
  ['tickets', 'assigned_to'],
  ['tickets', 'entered_via_principal_id'],
  ['comments', 'created_via_principal_id'],
  ['time_entries', 'created_by'],
  ['time_entries', 'updated_by'],
  ['time_entries', 'created_via_principal_id'],
  ['time_entries', 'updated_via_principal_id'],
  ['time_sheets', 'approved_via_principal_id'],
  ['schedule_entries', 'created_via_principal_id'],
  ['schedule_entry_assignees', 'user_id'],
  ['interactions', 'created_via_principal_id'],
  ['project_tasks', 'created_via_principal_id'],
  ['ticket_audit_logs', 'actor_user_id'],
  ['ticket_audit_logs', 'via_principal_user_id'],
  ['mcp_agent_audit', 'act_as_user_id'],
];

async function isReferenced(trx: Knex.Transaction, tenant: string, userId: string, agentId: string | null): Promise<boolean> {
  const db = tenantDb(trx, tenant);
  if (agentId) {
    const audit = await db.table('mcp_agent_audit').where({ agent_id: agentId }).first('agent_id');
    if (audit) return true;
  }
  for (const [table, column] of NON_FK_REFERENCES) {
    if (!(await trx.schema.hasTable(table)) || !(await trx.schema.hasColumn(table, column))) continue;
    const hit = await db.table(table).where({ [column]: userId }).first(column);
    if (hit) return true;
  }
  return false;
}

export type ArchiveOrDeleteOutcome = 'archived' | 'deleted';

/** R8.3: archive when referenced anywhere, otherwise hard delete. mcp_agent_audit is never deleted. */
export async function archiveOrDeleteServicePrincipal(
  knex: Knex,
  tenant: string,
  userId: string,
): Promise<ArchiveOrDeleteOutcome> {
  return knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);
    const existing = await db.table('service_principals').where({ user_id: userId }).first();
    if (!existing) throw notFound();
    const principal = existing as ServicePrincipalRecord;
    const agent =
      principal.kind === 'mcp_agent'
        ? await db.table('agents').where({ service_user_id: userId }).first('agent_id')
        : null;
    const agentId: string | null = agent?.agent_id ?? null;

    const archive = async (): Promise<ArchiveOrDeleteOutcome> => {
      await db.table('users').where({ user_id: userId }).update({ is_inactive: true });
      await db.table('api_keys').where({ user_id: userId }).del();
      if (agentId) {
        await db.table('agents').where({ agent_id: agentId }).update({
          active: false,
          idp_issuer: null,
          idp_subject: null,
          updated_at: trx.fn.now(),
        });
      }
      await db
        .table('service_principals')
        .where({ user_id: userId })
        .update({ archived_at: trx.fn.now(), updated_at: trx.fn.now() });
      return 'archived';
    };

    if (principal.archived_at) return 'archived';
    if (await isReferenced(trx, tenant, userId, agentId)) return archive();

    // Unreferenced as far as we can tell: try the hard delete under a savepoint so a
    // foreign-key reference we did not enumerate falls back to archiving, not failing.
    try {
      await trx.transaction(async (sp) => {
        const sdb = tenantDb(sp, tenant);
        await sdb.table('api_keys').where({ user_id: userId }).del();
        await sdb.table('user_roles').where({ user_id: userId }).del();
        if (agentId) {
          await sdb.table('agent_roles').where({ agent_id: agentId }).del();
          await sdb.table('agents').where({ agent_id: agentId }).del();
        }
        await sdb.table('service_principals').where({ user_id: userId }).del();
        await sdb.table('users').where({ user_id: userId }).del();
      });
      return 'deleted';
    } catch (error) {
      if ((error as { code?: string }).code !== '23503') throw error;
      return archive();
    }
  });
}

export interface IssuedServicePrincipalKey {
  api_key_id: string;
  /** Plaintext, shown once. */
  api_key: string;
  description: string | null;
  expires_at: string | null;
}

const ROTATION_GRACE_MS = 5 * 60 * 1000;

/**
 * Issues (or rotates) a `purpose='service'` key. Written directly, as
 * mintAgentSessionKey does: createApiKey stays internal-owner-only for every purpose.
 * Passing `rotateKeyId` caps the superseded key's life at a short grace window so
 * in-flight requests finish.
 */
export async function issueServicePrincipalKey(
  knex: Knex,
  tenant: string,
  userId: string,
  options: { description?: string | null; expiresAt?: Date | null; rotateKeyId?: string | null } = {},
): Promise<IssuedServicePrincipalKey> {
  await assertServicePrincipalTier(tenant);
  return knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);
    const principal = await loadPrincipal(trx, tenant, userId);
    const user = await db.table('users').where({ user_id: userId }).first('is_inactive', 'user_type');
    if (principal.archived_at || !user || user.is_inactive || user.user_type !== 'service') {
      throw new ServicePrincipalError(
        'SERVICE_PRINCIPAL_INACTIVE',
        'Keys can only be issued to an active service principal',
        409,
      );
    }

    if (options.rotateKeyId) {
      const old = await db
        .table('api_keys')
        .where({ api_key_id: options.rotateKeyId, user_id: userId, purpose: 'service' })
        .first('api_key_id');
      if (!old) throw new ServicePrincipalError('API_KEY_NOT_FOUND', 'Key not found', 404);
      await db
        .table('api_keys')
        .where({ api_key_id: options.rotateKeyId })
        .update({
          expires_at: trx.raw(`LEAST(COALESCE(expires_at, 'infinity'::timestamptz), now() + (? * interval '1 millisecond'))`, [
            ROTATION_GRACE_MS,
          ]),
          updated_at: trx.fn.now(),
        });
    }

    const plaintext = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(plaintext).digest('hex');
    const [record] = await db
      .table('api_keys')
      .insert({
        api_key: hash,
        user_id: userId,
        tenant,
        description: options.description ?? `service-principal:${principal.name}`,
        purpose: 'service',
        active: true,
        expires_at: options.expiresAt ?? null,
        usage_limit: null,
      })
      .returning(['api_key_id', 'description', 'expires_at']);
    return { ...record, api_key: plaintext } as IssuedServicePrincipalKey;
  });
}

export interface ServicePrincipalKeyListItem {
  api_key_id: string;
  description: string | null;
  active: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

/** Key metadata only; the hash is never returned. */
export async function listServicePrincipalKeys(
  knex: Knex | Knex.Transaction,
  tenant: string,
  userId: string,
): Promise<ServicePrincipalKeyListItem[]> {
  await loadPrincipal(knex, tenant, userId);
  return tenantDb(knex, tenant)
    .table('api_keys')
    .where({ user_id: userId, purpose: 'service' })
    .orderBy('created_at', 'desc')
    .select('api_key_id', 'description', 'active', 'expires_at', 'last_used_at', 'created_at');
}

export async function revokeServicePrincipalKey(
  knex: Knex,
  tenant: string,
  userId: string,
  apiKeyId: string,
): Promise<void> {
  const updated = await tenantDb(knex, tenant)
    .table('api_keys')
    .where({ api_key_id: apiKeyId, user_id: userId, purpose: 'service' })
    .update({ active: false, updated_at: knex.fn.now() });
  if (!updated) throw new ServicePrincipalError('API_KEY_NOT_FOUND', 'Key not found', 404);
}
