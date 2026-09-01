import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

import {
  normalizeEmail,
  type NormalizedScimUser,
  type ScimFilter,
  type ScimPatchOperation,
  ScimError,
  SCIM_LIST_SCHEMA,
  SCIM_USER_SCHEMA,
} from './protocol';

interface ScimConnectionRow {
  tenant: string;
  connection_id: string;
}

interface ScimLinkRow {
  tenant: string;
  link_id: string;
  connection_id: string;
  user_id: string;
  external_id: string;
  observed_user_name: string;
  observed_primary_email: string | null;
  observed_display_name: string | null;
  observed_given_name: string | null;
  observed_family_name: string | null;
  observed_title: string | null;
  upstream_active: boolean;
  link_state: 'active' | 'deprovisioned' | 'unlinked';
  scim_inactive_at: Date | string | null;
  last_operation_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface UserRow {
  user_id: string;
  email: string | null;
  username: string;
  first_name: string | null;
  last_name: string | null;
  is_inactive: boolean;
  user_type: string;
}

interface LinkWithUser extends ScimLinkRow {
  email: string | null;
  username: string;
  first_name: string | null;
  last_name: string | null;
  is_inactive: boolean;
}

interface ProvisionResult {
  resource?: Record<string, unknown>;
  conflict?: string;
}

const USER_SCHEMA_PATH = '/Schemas/urn:ietf:params:scim:schemas:core:2.0:User';

function dateIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullablePatchString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new ScimError(400, `${path} must be a string.`, 'invalidValue');
  }
  const normalized = value.trim();
  return normalized || null;
}

function patchActive(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new ScimError(400, 'active must be a boolean.', 'invalidValue');
  }
  return value;
}

export class ScimProvisioningService {
  constructor(
    private readonly knex: Knex,
    private readonly connection: ScimConnectionRow,
    private readonly baseUrl: string
  ) {
  }

  async listUsers(
    filter: ScimFilter | null,
    startIndex: number,
    count: number
  ): Promise<Record<string, unknown>> {
    const query = this.linkWithUserQuery()
      .whereNot('l.link_state', 'unlinked');

    if (filter?.attribute === 'userName') {
      query.whereRaw('lower(l.observed_user_name) = lower(?)', [filter.value]);
    } else if (filter?.attribute === 'externalId') {
      query.where('l.external_id', filter.value);
    }

    const rows = await query.orderBy('l.created_at', 'asc');
    const safeStart = Math.max(1, startIndex);
    const safeCount = Math.max(0, Math.min(200, count));
    const page = rows.slice(safeStart - 1, safeStart - 1 + safeCount);

    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: rows.length,
      startIndex: rows.length === 0 ? 1 : safeStart,
      itemsPerPage: page.length,
      Resources: page.map((row) => this.toResource(row as LinkWithUser)),
    };
  }

  async getUser(linkId: string): Promise<Record<string, unknown>> {
    const row = await this.linkWithUserQuery()
      .where('l.link_id', linkId)
      .whereNot('l.link_state', 'unlinked')
      .first();

    if (!row) {
      throw new ScimError(404, 'The SCIM user resource was not found.');
    }
    return this.toResource(row as LinkWithUser);
  }

  async createUser(input: NormalizedScimUser): Promise<Record<string, unknown>> {
    const result = await this.knex.transaction(async (trx): Promise<ProvisionResult> => {
      const existing = await this.findLinkByExternalId(trx, input.externalId);

      if (existing) {
        const link = await this.applyLifecycle(trx, existing, input, 'provision');
        return { resource: await this.resourceInTransaction(trx, link.link_id) };
      }

      const matchResult = await this.findEligibleMatch(trx, input);
      if (matchResult.candidates.length !== 1) {
        const reason = matchResult.reason;
        await this.upsertUnresolved(trx, input, reason);
        await this.recordOperation(trx, {
          operation: 'provision',
          outcome: 'rejected',
          externalId: input.externalId,
          detailCode: reason,
        });
        return { conflict: this.conflictDetail(reason) };
      }

      const user = matchResult.candidates[0];
      // Losing the unique-index race is an expected outcome, not a failure: the
      // insert runs in its own savepoint so that a violation rolls back only the
      // failed statement. The enclosing transaction stays usable and can still
      // read the winning row or record the conflict, neither of which is
      // possible once a bare INSERT has aborted the transaction.
      let link: ScimLinkRow | undefined;
      try {
        await trx.transaction(async (attempt) => {
          [link] = await tenantDb(attempt, this.connection.tenant)
            .table<ScimLinkRow>('scim_user_links')
            .insert({
              tenant: this.connection.tenant,
              connection_id: this.connection.connection_id,
              user_id: user.user_id,
              external_id: input.externalId,
              ...this.observedFields(input),
              upstream_active: input.active,
              link_state: 'active',
              last_operation_at: attempt.fn.now(),
              created_at: attempt.fn.now(),
              updated_at: attempt.fn.now(),
            })
            .returning('*');
        });
      } catch (error) {
        if ((error as { code?: string }).code !== '23505') {
          throw error;
        }

        // A concurrent provision of the same directory identity committed while
        // this one was running. Retries of the same SCIM POST must be idempotent,
        // so adopt the winning link instead of reporting a conflict.
        const winner = await this.findLinkByExternalId(trx, input.externalId);
        if (winner) {
          const adopted = await this.applyLifecycle(trx, winner, input, 'provision');
          return { resource: await this.resourceInTransaction(trx, adopted.link_id) };
        }

        // Otherwise the identity collides with a link this connection may not
        // reuse: an administrator-unlinked tombstone for the same externalId, or
        // an Alga user already managed by another link.
        await this.upsertUnresolved(trx, input, 'identity_conflict');
        await this.recordOperation(trx, {
          operation: 'provision',
          outcome: 'rejected',
          externalId: input.externalId,
          detailCode: 'identity_conflict',
        });
        return { conflict: this.conflictDetail('identity_conflict') };
      }

      if (!link) {
        throw new Error('SCIM persistence invariant failed: link insert returned no row.');
      }

      link = await this.applyLifecycle(trx, link, input, 'provision');
      await this.recordOperation(trx, {
        operation: 'link',
        outcome: 'success',
        linkId: link.link_id,
        externalId: input.externalId,
      });
      return { resource: await this.resourceInTransaction(trx, link.link_id) };
    });

    if (result.conflict) {
      throw new ScimError(409, result.conflict, 'uniqueness');
    }
    if (!result.resource) {
      throw new Error('SCIM persistence invariant failed: provision returned no resource.');
    }
    return result.resource;
  }

  async replaceUser(linkId: string, input: NormalizedScimUser): Promise<Record<string, unknown>> {
    return this.knex.transaction(async (trx) => {
      const link = await this.requireLockedLink(trx, linkId);
      if (link.external_id !== input.externalId) {
        throw new ScimError(409, 'externalId is immutable after linking.', 'mutability');
      }

      const updated = await this.applyLifecycle(trx, link, input, 'replace');
      return this.resourceInTransaction(trx, updated.link_id);
    });
  }

  async patchUser(
    linkId: string,
    operations: ScimPatchOperation[]
  ): Promise<Record<string, unknown>> {
    return this.knex.transaction(async (trx) => {
      const link = await this.requireLockedLink(trx, linkId);
      const next = this.applyPatchOperations(link, operations);
      const updated = await this.applyLifecycle(trx, link, next, 'patch');
      return this.resourceInTransaction(trx, updated.link_id);
    });
  }

  async deleteUser(linkId: string): Promise<void> {
    await this.knex.transaction(async (trx) => {
      const link = await this.requireLockedLink(trx, linkId, true);
      if (link.link_state === 'unlinked') {
        throw new ScimError(404, 'The SCIM user resource was not found.');
      }

      const input = this.inputFromLink(link);
      input.active = false;
      const updated = await this.applyLifecycle(trx, link, input, 'delete', 'deprovisioned');
      await this.recordOperation(trx, {
        operation: 'delete',
        outcome: 'success',
        linkId: updated.link_id,
        externalId: updated.external_id,
      });
    });
  }

  private linkWithUserQuery(connection: Knex | Knex.Transaction = this.knex) {
    const db = tenantDb(connection, this.connection.tenant);
    const query = db.table('scim_user_links as l').select(
      'l.*',
      'u.email',
      'u.username',
      'u.first_name',
      'u.last_name',
      'u.is_inactive'
    );
    db.tenantJoin(query, 'users as u', 'u.user_id', 'l.user_id');
    return query.where('l.connection_id', this.connection.connection_id);
  }

  private async resourceInTransaction(
    trx: Knex.Transaction,
    linkId: string
  ): Promise<Record<string, unknown>> {
    const row = await this.linkWithUserQuery(trx)
      .where('l.link_id', linkId)
      .first();
    if (!row) {
      throw new ScimError(404, 'The SCIM user resource was not found.');
    }
    return this.toResource(row as LinkWithUser);
  }

  private toResource(row: LinkWithUser): Record<string, unknown> {
    const resourceLocation = `${this.baseUrl}/Users/${row.link_id}`;
    const emails = row.observed_primary_email
      ? [{ value: row.observed_primary_email, type: 'work', primary: true }]
      : [];

    return {
      schemas: [SCIM_USER_SCHEMA],
      id: row.link_id,
      externalId: row.external_id,
      userName: row.observed_user_name,
      active: row.upstream_active && row.link_state !== 'deprovisioned',
      ...(row.observed_display_name ? { displayName: row.observed_display_name } : {}),
      name: {
        ...(row.observed_given_name ? { givenName: row.observed_given_name } : {}),
        ...(row.observed_family_name ? { familyName: row.observed_family_name } : {}),
      },
      emails,
      ...(row.observed_title ? { title: row.observed_title } : {}),
      meta: {
        resourceType: 'User',
        created: dateIso(row.created_at),
        lastModified: dateIso(row.updated_at),
        location: resourceLocation,
      },
    };
  }

  private observedFields(input: NormalizedScimUser) {
    return {
      observed_user_name: input.userName,
      observed_primary_email: input.primaryEmail,
      observed_display_name: input.displayName,
      observed_given_name: input.givenName,
      observed_family_name: input.familyName,
      observed_title: input.title,
    };
  }

  private inputFromLink(link: ScimLinkRow): NormalizedScimUser {
    return {
      externalId: link.external_id,
      userName: link.observed_user_name,
      active: link.upstream_active,
      primaryEmail: link.observed_primary_email,
      displayName: link.observed_display_name,
      givenName: link.observed_given_name,
      familyName: link.observed_family_name,
      title: link.observed_title,
    };
  }

  private async requireLockedLink(
    trx: Knex.Transaction,
    linkId: string,
    includeUnlinked = false
  ): Promise<ScimLinkRow> {
    const query = tenantDb(trx, this.connection.tenant)
      .table<ScimLinkRow>('scim_user_links')
      .where({
        connection_id: this.connection.connection_id,
        link_id: linkId,
      })
      .forUpdate();
    if (!includeUnlinked) query.whereNot('link_state', 'unlinked');
    const link = await query.first();
    if (!link) {
      throw new ScimError(404, 'The SCIM user resource was not found.');
    }
    return link;
  }

  private async findLinkByExternalId(
    trx: Knex.Transaction,
    externalId: string
  ): Promise<ScimLinkRow | undefined> {
    return tenantDb(trx, this.connection.tenant)
      .table<ScimLinkRow>('scim_user_links')
      .where({
        connection_id: this.connection.connection_id,
        external_id: externalId,
      })
      .whereNot('link_state', 'unlinked')
      .forUpdate()
      .first();
  }

  private async findEligibleMatch(
    trx: Knex.Transaction,
    input: NormalizedScimUser
  ): Promise<{ candidates: UserRow[]; reason: string }> {
    if (!input.primaryEmail) {
      return { candidates: [], reason: 'primary_email_required' };
    }

    const db = tenantDb(trx, this.connection.tenant);
    const normalizedEmail = normalizeEmail(input.primaryEmail);
    const candidatesQuery = db.table<UserRow>('users as u')
      .select('u.user_id', 'u.email', 'u.username', 'u.first_name', 'u.last_name', 'u.is_inactive', 'u.user_type')
      .where('u.user_type', 'internal')
      .where('u.is_inactive', false)
      .whereRaw('lower(trim(u.email)) = ?', [normalizedEmail])
      .whereNotExists(
        db.table('scim_user_links as existing_link')
          .select(this.knex.raw('1'))
          .whereRaw('?? = ??', ['existing_link.user_id', 'u.user_id'])
          .whereNot('existing_link.link_state', 'unlinked')
      )
      .forUpdate();
    const candidates = await candidatesQuery;

    if (candidates.length === 0) return { candidates, reason: 'no_eligible_exact_match' };
    if (candidates.length > 1) return { candidates, reason: 'multiple_exact_matches' };
    return { candidates, reason: 'matched' };
  }

  private async applyLifecycle(
    trx: Knex.Transaction,
    link: ScimLinkRow,
    input: NormalizedScimUser,
    operation: string,
    linkState: ScimLinkRow['link_state'] = 'active'
  ): Promise<ScimLinkRow> {
    const db = tenantDb(trx, this.connection.tenant);
    const user = await db.table<UserRow>('users')
      .where('user_id', link.user_id)
      .forUpdate()
      .first();
    if (!user || user.user_type !== 'internal') {
      throw new ScimError(409, 'The linked Alga user is no longer eligible for SCIM management.');
    }

    let scimInactiveAt = link.scim_inactive_at;
    let outcome = 'success';
    let lifecycleOperation = operation;

    if (!input.active) {
      if (!user.is_inactive) {
        await db.table('users').where('user_id', link.user_id).update({
          is_inactive: true,
          updated_at: trx.fn.now(),
        });
        lifecycleOperation = link.scim_inactive_at ? operation : 'deactivate';
        scimInactiveAt = scimInactiveAt ?? new Date();
      } else if (!link.scim_inactive_at) {
        // The user was already inactive before this SCIM operation. Preserve
        // manual/other-policy authority instead of claiming deactivation
        // provenance that could later permit SCIM to reactivate the user.
        outcome = 'source_guarded';
      }

      await db.table('sessions')
        .where('user_id', link.user_id)
        .whereNull('revoked_at')
        .update({
          revoked_at: trx.fn.now(),
          revoked_reason: 'scim',
          updated_at: trx.fn.now(),
        });
    } else if (link.scim_inactive_at) {
      if (user.is_inactive) {
        await db.table('users').where('user_id', link.user_id).update({
          is_inactive: false,
          updated_at: trx.fn.now(),
        });
        lifecycleOperation = 'reactivate';
      }
      scimInactiveAt = null;
    } else if (user.is_inactive) {
      // A manual or other-policy inactivity remains authoritative.
      outcome = 'source_guarded';
    }

    const [updated] = await db.table<ScimLinkRow>('scim_user_links')
      .where('link_id', link.link_id)
      .update({
        ...this.observedFields(input),
        upstream_active: input.active,
        link_state: linkState,
        scim_inactive_at: scimInactiveAt,
        last_operation_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning('*') as ScimLinkRow[];

    await this.recordOperation(trx, {
      operation: lifecycleOperation,
      outcome,
      linkId: updated.link_id,
      externalId: updated.external_id,
      detailCode: outcome === 'source_guarded' ? 'manual_inactivity_preserved' : undefined,
    });
    return updated;
  }

  private applyPatchOperations(
    link: ScimLinkRow,
    operations: ScimPatchOperation[]
  ): NormalizedScimUser {
    const next = this.inputFromLink(link);

    const assignObject = (value: unknown): void => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ScimError(400, 'A PATCH operation without path requires an object value.', 'invalidValue');
      }
      for (const [key, fieldValue] of Object.entries(value)) {
        this.assignPatchPath(next, key, fieldValue, false);
      }
    };

    for (const operation of operations) {
      if (!operation.path) {
        if (operation.op === 'remove') {
          throw new ScimError(400, 'PATCH remove requires a path.', 'noTarget');
        }
        assignObject(operation.value);
        continue;
      }
      this.assignPatchPath(next, operation.path, operation.value, operation.op === 'remove');
    }

    return next;
  }

  private assignPatchPath(
    next: NormalizedScimUser,
    rawPath: string,
    value: unknown,
    remove: boolean
  ): void {
    const path = rawPath.toLowerCase();
    if (path === 'active') {
      if (remove) throw new ScimError(400, 'active cannot be removed.', 'mutability');
      next.active = patchActive(value);
      return;
    }
    if (path === 'externalid') {
      throw new ScimError(400, 'externalId is immutable after linking.', 'mutability');
    }
    if (path === 'username') {
      const userName = remove ? null : nullablePatchString(value, 'userName');
      if (!userName) throw new ScimError(400, 'userName cannot be removed.', 'mutability');
      next.userName = userName;
      return;
    }
    if (path === 'displayname') {
      next.displayName = remove ? null : nullablePatchString(value, 'displayName');
      return;
    }
    if (path === 'title') {
      next.title = remove ? null : nullablePatchString(value, 'title');
      return;
    }
    if (path === 'name.givenname') {
      next.givenName = remove ? null : nullablePatchString(value, 'name.givenName');
      return;
    }
    if (path === 'name.familyname') {
      next.familyName = remove ? null : nullablePatchString(value, 'name.familyName');
      return;
    }
    if (path === 'emails' || /^emails\[type eq ["']work["']\]\.value$/.test(path)) {
      if (remove) {
        next.primaryEmail = null;
      } else if (path === 'emails') {
        if (!Array.isArray(value)) {
          throw new ScimError(400, 'emails must be an array.', 'invalidValue');
        }
        const primary = value.find(
          (entry) => entry && typeof entry === 'object' && (entry as { primary?: unknown }).primary === true
        ) as { value?: unknown } | undefined;
        next.primaryEmail = primary
          ? nullablePatchString(primary.value, 'emails.value')
          : null;
      } else {
        next.primaryEmail = nullablePatchString(value, rawPath);
      }
      return;
    }
    if (path === 'name') {
      if (remove) {
        next.givenName = null;
        next.familyName = null;
        return;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ScimError(400, 'name must be an object.', 'invalidValue');
      }
      const name = value as Record<string, unknown>;
      if ('givenName' in name) next.givenName = nullablePatchString(name.givenName, 'name.givenName');
      if ('familyName' in name) next.familyName = nullablePatchString(name.familyName, 'name.familyName');
      return;
    }

    throw new ScimError(400, `Unsupported PATCH path ${rawPath}.`, 'invalidPath');
  }

  private async upsertUnresolved(
    trx: Knex.Transaction,
    input: NormalizedScimUser,
    reason: string
  ): Promise<void> {
    const db = tenantDb(trx, this.connection.tenant);
    const existing = await db.table('scim_unresolved_identities')
      .where({
        connection_id: this.connection.connection_id,
        external_id: input.externalId || null,
        observed_user_name: input.userName,
        resolution_state: 'open',
      })
      .forUpdate()
      .first();

    if (existing) {
      await db.table('scim_unresolved_identities')
        .where('unresolved_id', existing.unresolved_id)
        .update({
          observed_primary_email: input.primaryEmail,
          observed_display_name: input.displayName,
          observed_active: input.active,
          failure_reason: reason,
          attempt_count: trx.raw('attempt_count + 1'),
          last_seen_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        });
      return;
    }

    await db.table('scim_unresolved_identities').insert({
      tenant: this.connection.tenant,
      connection_id: this.connection.connection_id,
      external_id: input.externalId || null,
      observed_user_name: input.userName,
      observed_primary_email: input.primaryEmail,
      observed_display_name: input.displayName,
      observed_active: input.active,
      failure_reason: reason,
      resolution_state: 'open',
      attempt_count: 1,
      first_seen_at: trx.fn.now(),
      last_seen_at: trx.fn.now(),
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
  }

  private conflictDetail(reason: string): string {
    const details: Record<string, string> = {
      primary_email_required: 'A primary SCIM email is required for initial linking.',
      no_eligible_exact_match: 'No eligible active internal Alga user exactly matches the primary email.',
      multiple_exact_matches: 'More than one eligible Alga user matches the primary email.',
      identity_conflict: 'The directory identity or Alga user is already managed by another SCIM link.',
    };
    return details[reason] ?? 'The SCIM identity could not be linked safely.';
  }

  private async recordOperation(
    trx: Knex.Transaction,
    event: {
      operation: string;
      outcome: string;
      linkId?: string;
      externalId?: string;
      detailCode?: string;
    }
  ): Promise<void> {
    await tenantDb(trx, this.connection.tenant).table('scim_operations').insert({
      tenant: this.connection.tenant,
      connection_id: this.connection.connection_id,
      link_id: event.linkId ?? null,
      external_id: event.externalId ?? null,
      operation: event.operation,
      outcome: event.outcome,
      detail_code: event.detailCode ?? null,
      sanitized_detail: JSON.stringify({}),
      created_at: trx.fn.now(),
    });
  }
}

export const SCIM_SERVICE_PROVIDER_CONFIG = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
  documentationUri: 'https://www.nineminds.com/documentation/scim-user-provisioning',
  patch: { supported: true },
  bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: { supported: true, maxResults: 200 },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [
    {
      type: 'oauthbearertoken',
      name: 'Bearer token',
      description: 'Tenant-specific SCIM bearer token.',
      specUri: 'https://www.rfc-editor.org/rfc/rfc6750',
      primary: true,
    },
  ],
};

export function scimSchemas(baseUrl: string): Record<string, unknown> {
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 1,
    startIndex: 1,
    itemsPerPage: 1,
    Resources: [
      {
        id: SCIM_USER_SCHEMA,
        name: 'User',
        description: 'Alga internal user lifecycle resource',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
          { name: 'externalId', type: 'string', multiValued: false, required: true, caseExact: true, mutability: 'immutable', returned: 'default', uniqueness: 'server' },
          { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
          { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
          { name: 'title', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
          { name: 'name', type: 'complex', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
          { name: 'emails', type: 'complex', multiValued: true, required: false, mutability: 'readWrite', returned: 'default' },
        ],
        meta: {
          resourceType: 'Schema',
          location: `${baseUrl}${USER_SCHEMA_PATH}`,
        },
      },
    ],
  };
}

export function scimResourceTypes(baseUrl: string): Record<string, unknown> {
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 1,
    startIndex: 1,
    itemsPerPage: 1,
    Resources: [
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'User',
        name: 'User',
        endpoint: '/Users',
        description: 'Alga internal user lifecycle resource',
        schema: SCIM_USER_SCHEMA,
        schemaExtensions: [],
        meta: {
          resourceType: 'ResourceType',
          location: `${baseUrl}/ResourceTypes/User`,
        },
      },
    ],
  };
}
