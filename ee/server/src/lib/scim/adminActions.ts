'use server';

import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { TIER_FEATURES, type IUserWithRoles } from '@alga-psa/types';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';

import { generateScimToken } from './credentials';
import { normalizeEmail, ScimError } from './protocol';

const TOKEN_OVERLAP_HOURS = 24;

export interface ScimConnectionView {
  connectionId: string;
  endpointPath: string;
  enabled: boolean;
  tokenGeneration: number;
  tokenCreatedAt: string | null;
  previousTokenExpiresAt: string | null;
  hasPreviousToken: boolean;
  lastAuthenticatedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
}

export interface ScimLinkView {
  linkId: string;
  userId: string;
  externalId: string;
  directoryEmail: string | null;
  directoryUserName: string;
  algaEmail: string | null;
  algaName: string;
  upstreamActive: boolean;
  effectiveActive: boolean;
  linkState: string;
  lifecycleSource: 'scim' | 'alga';
  hasEmailDrift: boolean;
  lastOperationAt: string | null;
}

export interface ScimUnresolvedView {
  unresolvedId: string;
  externalId: string | null;
  userName: string;
  primaryEmail: string | null;
  displayName: string | null;
  upstreamActive: boolean;
  failureReason: string;
  attemptCount: number;
  lastSeenAt: string;
}

export interface ScimOperationView {
  operationId: string;
  operation: string;
  outcome: string;
  detailCode: string | null;
  createdAt: string;
}

export interface ScimProvisioningOverview {
  connection: ScimConnectionView | null;
  links: ScimLinkView[];
  unresolved: ScimUnresolvedView[];
  operations: ScimOperationView[];
}

export interface ScimTokenResult {
  token: string;
  connection: ScimConnectionView;
}

interface ScimConnectionRow {
  connection_id: string;
  enabled: boolean;
  current_token_generation: number | string | null;
  current_token_created_at: Date | string | null;
  previous_token_hash: string | null;
  previous_token_expires_at: Date | string | null;
  last_authenticated_at: Date | string | null;
  last_success_at: Date | string | null;
  last_error_code: string | null;
}

async function requireScimPermission(
  user: IUserWithRoles,
  tenant: string,
  action: 'read' | 'update'
): Promise<Knex> {
  await assertTierAccess(TIER_FEATURES.SCIM_PROVISIONING);
  const { knex } = await createTenantKnex();
  if (!await hasPermission(user, 'security_settings', action, knex)) {
    throw new Error(`Permission denied: security_settings ${action} is required.`);
  }
  if (user.tenant !== tenant) {
    throw new Error('Tenant context mismatch.');
  }
  return knex;
}

function iso(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

function requiredIso(value: Date | string | null | undefined, field: string): string {
  const result = iso(value);
  if (!result) {
    throw new Error(`SCIM persistence invariant failed: ${field} is required.`);
  }
  return result;
}

function connectionView(row: ScimConnectionRow): ScimConnectionView {
  return {
    connectionId: row.connection_id,
    endpointPath: `/api/scim/v2/${row.connection_id}`,
    enabled: Boolean(row.enabled),
    tokenGeneration: Number(row.current_token_generation ?? 0),
    tokenCreatedAt: iso(row.current_token_created_at),
    previousTokenExpiresAt: iso(row.previous_token_expires_at),
    hasPreviousToken: Boolean(row.previous_token_hash),
    lastAuthenticatedAt: iso(row.last_authenticated_at),
    lastSuccessAt: iso(row.last_success_at),
    lastErrorCode: row.last_error_code ?? null,
  };
}

async function writeAudit(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  operation: string,
  recordId: string,
  details: Record<string, unknown>
): Promise<void> {
  await tenantDb(trx, tenant).table('audit_logs').insert({
    tenant,
    audit_id: randomUUID(),
    user_id: userId,
    operation,
    table_name: 'scim_connections',
    record_id: recordId,
    changed_data: JSON.stringify({}),
    details: JSON.stringify(details),
    timestamp: trx.fn.now(),
  });
}

export const getScimProvisioningOverview = withAuth(async (
  user,
  { tenant }
): Promise<ScimProvisioningOverview> => {
  const knex = await requireScimPermission(user, tenant, 'read');
  const db = tenantDb(knex, tenant);
  const connection = await db.table('scim_connections').first();
  if (!connection) {
    return { connection: null, links: [], unresolved: [], operations: [] };
  }

  const linksQuery = db.table('scim_user_links as l').select(
    'l.*',
    'u.email as alga_email',
    'u.first_name',
    'u.last_name',
    'u.is_inactive'
  );
  db.tenantJoin(linksQuery, 'users as u', 'u.user_id', 'l.user_id');

  const [links, unresolved, operations] = await Promise.all([
    linksQuery
      .where('l.connection_id', connection.connection_id)
      .whereNot('l.link_state', 'unlinked')
      .orderBy('l.updated_at', 'desc'),
    db.table('scim_unresolved_identities')
      .where({
        connection_id: connection.connection_id,
        resolution_state: 'open',
      })
      .orderBy('last_seen_at', 'desc')
      .limit(100),
    db.table('scim_operations')
      .where('connection_id', connection.connection_id)
      .orderBy('created_at', 'desc')
      .limit(50),
  ]);

  return {
    connection: connectionView(connection),
    links: links.map((row): ScimLinkView => ({
      linkId: row.link_id,
      userId: row.user_id,
      externalId: row.external_id,
      directoryEmail: row.observed_primary_email,
      directoryUserName: row.observed_user_name,
      algaEmail: row.alga_email,
      algaName: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.alga_email || 'Unknown user',
      upstreamActive: Boolean(row.upstream_active) && row.link_state !== 'deprovisioned',
      effectiveActive: !row.is_inactive,
      linkState: row.link_state,
      lifecycleSource: row.scim_inactive_at ? 'scim' : 'alga',
      hasEmailDrift: Boolean(
        row.observed_primary_email
        && row.alga_email
        && normalizeEmail(row.observed_primary_email) !== normalizeEmail(row.alga_email)
      ),
      lastOperationAt: iso(row.last_operation_at),
    })),
    unresolved: unresolved.map((row): ScimUnresolvedView => ({
      unresolvedId: row.unresolved_id,
      externalId: row.external_id,
      userName: row.observed_user_name,
      primaryEmail: row.observed_primary_email,
      displayName: row.observed_display_name,
      upstreamActive: Boolean(row.observed_active),
      failureReason: row.failure_reason,
      attemptCount: Number(row.attempt_count),
      lastSeenAt: requiredIso(row.last_seen_at, 'last_seen_at'),
    })),
    operations: operations.map((row): ScimOperationView => ({
      operationId: row.operation_id,
      operation: row.operation,
      outcome: row.outcome,
      detailCode: row.detail_code,
      createdAt: requiredIso(row.created_at, 'created_at'),
    })),
  };
});

export const createScimConnection = withAuth(async (
  user,
  { tenant }
): Promise<ScimTokenResult> => {
  const knex = await requireScimPermission(user, tenant, 'update');
  const generated = generateScimToken();

  return knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);
    const existing = await db.table('scim_connections').forUpdate().first();
    if (existing) {
      throw new Error('This tenant already has a SCIM connection.');
    }

    const [connection] = await db.table('scim_connections').insert({
      tenant,
      enabled: true,
      current_token_hash: generated.hash,
      current_token_generation: 1,
      current_token_created_at: trx.fn.now(),
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    }).returning('*');

    await writeAudit(trx, tenant, user.user_id, 'scim_connection_created', connection.connection_id, {
      enabled: true,
      tokenGeneration: 1,
    });

    return {
      token: generated.plaintext,
      connection: connectionView(connection),
    };
  });
});

export const rotateScimToken = withAuth(async (
  user,
  { tenant }
): Promise<ScimTokenResult> => {
  const knex = await requireScimPermission(user, tenant, 'update');
  const generated = generateScimToken();

  return knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);
    const connection = await db.table('scim_connections').forUpdate().first();
    if (!connection) throw new Error('Configure SCIM before rotating its token.');

    const previousTokenExpiresAt = new Date(Date.now() + TOKEN_OVERLAP_HOURS * 60 * 60 * 1000);
    const [updated] = await db.table('scim_connections')
      .where('connection_id', connection.connection_id)
      .update({
        current_token_hash: generated.hash,
        current_token_generation: Number(connection.current_token_generation ?? 0) + 1,
        current_token_created_at: trx.fn.now(),
        previous_token_hash: connection.current_token_hash,
        previous_token_expires_at: connection.current_token_hash ? previousTokenExpiresAt : null,
        updated_at: trx.fn.now(),
      })
      .returning('*');

    await writeAudit(trx, tenant, user.user_id, 'scim_token_rotated', connection.connection_id, {
      tokenGeneration: updated.current_token_generation,
      overlapHours: TOKEN_OVERLAP_HOURS,
    });
    return {
      token: generated.plaintext,
      connection: connectionView(updated),
    };
  });
});

export const revokeScimToken = withAuth(async (
  user,
  { tenant },
  generation: 'current' | 'previous'
): Promise<ScimConnectionView> => {
  const knex = await requireScimPermission(user, tenant, 'update');
  return knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);
    const connection = await db.table('scim_connections').forUpdate().first();
    if (!connection) throw new Error('SCIM is not configured.');

    const patch = generation === 'current'
      ? { current_token_hash: null, current_token_created_at: null, updated_at: trx.fn.now() }
      : { previous_token_hash: null, previous_token_expires_at: null, updated_at: trx.fn.now() };
    const [updated] = await db.table('scim_connections')
      .where('connection_id', connection.connection_id)
      .update(patch)
      .returning('*');

    await writeAudit(trx, tenant, user.user_id, 'scim_token_revoked', connection.connection_id, {
      generation,
    });
    return connectionView(updated);
  });
});

export const setScimConnectionEnabled = withAuth(async (
  user,
  { tenant },
  enabled: boolean
): Promise<ScimConnectionView> => {
  const knex = await requireScimPermission(user, tenant, 'update');
  return knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);
    const connection = await db.table('scim_connections').forUpdate().first();
    if (!connection) throw new Error('SCIM is not configured.');
    const [updated] = await db.table('scim_connections')
      .where('connection_id', connection.connection_id)
      .update({ enabled, updated_at: trx.fn.now() })
      .returning('*');
    await writeAudit(trx, tenant, user.user_id, enabled ? 'scim_enabled' : 'scim_disabled', connection.connection_id, {
      enabled,
      userStatesPreserved: true,
    });
    return connectionView(updated);
  });
});

export const unlinkScimUser = withAuth(async (
  user,
  { tenant },
  linkId: string
): Promise<void> => {
  const knex = await requireScimPermission(user, tenant, 'update');
  await knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);
    const link = await db.table('scim_user_links')
      .where('link_id', linkId)
      .whereNot('link_state', 'unlinked')
      .forUpdate()
      .first();
    if (!link) throw new Error('SCIM user link not found.');

    await db.table('scim_user_links').where('link_id', linkId).update({
      link_state: 'unlinked',
      updated_at: trx.fn.now(),
    });
    await db.table('scim_operations').insert({
      tenant,
      connection_id: link.connection_id,
      link_id: link.link_id,
      external_id: link.external_id,
      operation: 'unlink',
      outcome: 'success',
      sanitized_detail: JSON.stringify({ effectiveUserStateChanged: false }),
      created_at: trx.fn.now(),
    });
    await writeAudit(trx, tenant, user.user_id, 'scim_user_unlinked', link.connection_id, {
      linkId,
      userId: link.user_id,
      effectiveUserStateChanged: false,
    });
  });
});

export const resolveScimIdentity = withAuth(async (
  user,
  { tenant },
  unresolvedId: string,
  targetUserId: string,
  confirmEmailMismatch: boolean
): Promise<void> => {
  const knex = await requireScimPermission(user, tenant, 'update');
  await knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);
    const unresolved = await db.table('scim_unresolved_identities')
      .where({ unresolved_id: unresolvedId, resolution_state: 'open' })
      .forUpdate()
      .first();
    if (!unresolved) throw new Error('Unresolved SCIM identity not found.');
    if (!unresolved.external_id) throw new Error('The directory identity is missing externalId.');

    const target = await db.table('users')
      .where({ user_id: targetUserId, user_type: 'internal', is_inactive: false })
      .forUpdate()
      .first();
    if (!target) throw new Error('Select an active internal Alga user.');

    const mismatch = Boolean(
      unresolved.observed_primary_email
      && target.email
      && normalizeEmail(unresolved.observed_primary_email) !== normalizeEmail(target.email)
    );
    if (mismatch && !confirmEmailMismatch) {
      throw new ScimError(409, 'Confirm the email mismatch before linking this identity.');
    }

    const existingLink = await db.table('scim_user_links')
      .where('user_id', targetUserId)
      .whereNot('link_state', 'unlinked')
      .first();
    if (existingLink) throw new Error('The selected Alga user is already managed by SCIM.');

    const [link] = await db.table('scim_user_links').insert({
      tenant,
      connection_id: unresolved.connection_id,
      user_id: targetUserId,
      external_id: unresolved.external_id,
      observed_user_name: unresolved.observed_user_name,
      observed_primary_email: unresolved.observed_primary_email,
      observed_display_name: unresolved.observed_display_name,
      upstream_active: Boolean(unresolved.observed_active),
      link_state: unresolved.observed_active ? 'active' : 'deprovisioned',
      scim_inactive_at: unresolved.observed_active ? null : trx.fn.now(),
      last_operation_at: trx.fn.now(),
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    }).returning('*');

    if (!unresolved.observed_active) {
      await db.table('users').where('user_id', targetUserId).update({
        is_inactive: true,
        updated_at: trx.fn.now(),
      });
      await db.table('sessions')
        .where('user_id', targetUserId)
        .whereNull('revoked_at')
        .update({
          revoked_at: trx.fn.now(),
          revoked_reason: 'scim',
          updated_at: trx.fn.now(),
        });
    }

    await db.table('scim_unresolved_identities')
      .where('unresolved_id', unresolvedId)
      .update({
        resolution_state: 'resolved',
        resolved_user_id: targetUserId,
        resolved_by: user.user_id,
        resolved_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
    await db.table('scim_operations').insert({
      tenant,
      connection_id: unresolved.connection_id,
      link_id: link.link_id,
      external_id: unresolved.external_id,
      operation: 'manual_link',
      outcome: 'success',
      sanitized_detail: JSON.stringify({ emailMismatchConfirmed: mismatch }),
      created_at: trx.fn.now(),
    });
    await writeAudit(trx, tenant, user.user_id, 'scim_identity_manually_linked', unresolved.connection_id, {
      linkId: link.link_id,
      userId: targetUserId,
      emailMismatchConfirmed: mismatch,
    });
  });
});
