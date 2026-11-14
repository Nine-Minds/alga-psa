import { isClientUserType, isMspPrincipalUserType } from '@alga-psa/types';
import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import User from '@alga-psa/db/models/user';
import type { IUserWithRoles } from '@alga-psa/types';
import type { Knex } from 'knex';
import {
  audiencesVisibleTo, commentAudienceSql, isCommentAudience, isCommentAudienceVisible, admitCommentAudienceReader,
  type CommentAudienceReader,
} from '@alga-psa/shared/lib/commentAudience';

import type { AclMetadata, SearchObjectType } from '@alga-psa/types';

import { resolveClientScopes, type ClientScopedObjectType } from './clientScope';

export interface ComposedAclHints {
  visibleToUserIds: string[];
  visibleToRoles: string[];
  isInternalOnly: boolean;
  isPrivate: boolean;
  clientScopeId?: string;
  requiredPermission?: string;
}

/**
 * Client visibility for a search principal. `all` means unrestricted. `scoped` means the principal
 * may only see rows whose `client_scope_id` is in `clientIds`, on every object type: client-portal
 * users (their own client). `by_resource` is an internal user whose authorization-bundle rules
 * restrict clients per resource: each entry of `clientIdsByResource` bounds the search types of that
 * resource only (see SEARCH_TYPE_RESOURCE); a resource with no entry is unrestricted, and an empty
 * set means nothing of that resource is readable. The explicit mode, never an empty array standing
 * for "unrestricted", is what lets the SQL predicate and the per-row verifiers agree;
 * `resolveClientAccess` is the only place that decides it.
 *
 * `boardIds` is a second, independent restriction: when present, ticket rows (and ticket comments)
 * are limited to those boards, whatever the client mode.
 */
export type ClientAccess =
  | { mode: 'all'; boardIds?: string[] }
  | { mode: 'scoped'; clientIds: string[]; boardIds?: string[] }
  | { mode: 'by_resource'; clientIdsByResource: Readonly<Record<string, readonly string[]>>; boardIds?: string[] };

/** The authorization resource whose `read` rules bound the clients of each client-bounded search type. */
export const SEARCH_TYPE_RESOURCE: Readonly<Record<string, string>> = {
  ticket: 'ticket',
  ticket_comment: 'ticket',
  project: 'project',
  project_phase: 'project',
  project_task: 'project',
  project_task_comment: 'project',
  asset: 'asset',
  client: 'client',
  contact: 'contact',
  document: 'document',
  interaction: 'interaction',
  time_entry: 'time_entry',
};

/** The clients `access` allows for rows of `objectType`; null when that type is not client-restricted. */
export function clientIdsForObjectType(access: ClientAccess | undefined, objectType: string): readonly string[] | null {
  if (!access || access.mode === 'all') return null;
  if (access.mode === 'scoped') return access.clientIds;
  const resource = SEARCH_TYPE_RESOURCE[objectType];
  return resource !== undefined ? access.clientIdsByResource[resource] ?? null : null;
}

export interface SearchAclPrincipal {
  userId: string;
  tenant?: string;
  permissions: string[];
  roles?: string[];
  isInternal?: boolean;
  clientAccess: ClientAccess;
  /**
   * The organization an internal principal reads comments as (`admitCommentAudienceReader`).
   * `staff` sees every audience stored in its tenant; a `seat` technician sees the audiences the
   * shared predicate admits on its own client's tickets; `null` is a seat user with no live
   * assignment and sees no comment. Unset means owning-tenant staff, as before the seat shape.
   */
  audienceReader?: CommentAudienceReader | null;
}

export interface SqlFragment {
  sql: string;
  bindings: unknown[];
}

export interface SearchVisibilityRow {
  type: SearchObjectType;
  id: string;
  parentId?: string;
}

export type SearchVisibilityVerifier<TRow extends SearchVisibilityRow = SearchVisibilityRow> = (
  knex: Knex,
  user: SearchAclPrincipal,
  row: TRow,
) => Promise<boolean>;

const visibilityVerifiers = new Map<SearchObjectType, SearchVisibilityVerifier>();
const SEARCH_ACL_MISSING_TENANT = '__search_acl_missing_tenant__';
const SEARCH_ACL_MISSING_TENANT_REASON =
  'search ACL verifier has no tenant principal and must fail closed';

function emitAclDrift(row: SearchVisibilityRow, user: SearchAclPrincipal): void {
  const payload = {
    metric: 'search.acl_drift',
    objectType: row.type,
    objectId: row.id,
    userId: user.userId,
    tenant: user.tenant,
  };

  logger.warn('[SearchACL] search.acl_drift', payload);

  const sentry = (globalThis as {
    Sentry?: {
      captureMessage?: (message: string, context?: Record<string, unknown>) => void;
    };
  }).Sentry;

  sentry?.captureMessage?.('search.acl_drift', {
    level: 'warning',
    extra: payload,
  });
}

export function composeAclHints(opts: AclMetadata = {}): ComposedAclHints {
  return {
    visibleToUserIds: opts.visibleToUserIds ?? [],
    visibleToRoles: opts.visibleToRoles ?? [],
    isInternalOnly: opts.isInternalOnly ?? false,
    isPrivate: opts.isPrivate ?? false,
    clientScopeId: opts.clientScopeId,
    requiredPermission: opts.requiredPermission,
  };
}

/**
 * Object types whose client scope is strict: for a scoped principal a NULL `client_scope_id` is
 * NOT tenant-wide, it is "unknown owner" and must be hidden. These are the types whose records
 * belong to a client (tickets and their comments, and the five indexed from the table manifest's
 * client declarations). Unrestricted principals still see them. Shared by the SQL predicate (so
 * counts and result pages agree) and the per-row verifiers.
 */
export const STRICT_CLIENT_SCOPE_OBJECT_TYPES: readonly string[] = [
  'ticket',
  'ticket_comment',
  'client',
  'contact',
  'interaction',
  'document',
  'time_entry',
];

/** Object types whose rows belong to a ticket, and so to the ticket's board. */
const BOARD_SCOPED_OBJECT_TYPES: readonly string[] = ['ticket', 'ticket_comment'];

const NULL_SCOPE_OR_IN_SET =
  '((client_scope_id IS NULL AND NOT (object_type = ANY(?::text[]))) OR client_scope_id = ANY(?::uuid[]))';

/** Client-scope predicate: one set for every type (`scoped`), or each resource's set for its own types (`by_resource`). */
function clientScopeSql(access: ClientAccess): SqlFragment {
  if (access.mode === 'all') return { sql: 'TRUE', bindings: [] };
  if (access.mode === 'scoped') {
    return { sql: NULL_SCOPE_OR_IN_SET, bindings: [[...STRICT_CLIENT_SCOPE_OBJECT_TYPES], access.clientIds] };
  }
  const clauses: string[] = [];
  const bindings: unknown[] = [];
  for (const [resource, clientIds] of Object.entries(access.clientIdsByResource)) {
    const types = Object.entries(SEARCH_TYPE_RESOURCE).filter(([, r]) => r === resource).map(([type]) => type);
    if (types.length === 0) continue;
    clauses.push(`(NOT (object_type = ANY(?::text[])) OR ${NULL_SCOPE_OR_IN_SET})`);
    bindings.push(types, [...STRICT_CLIENT_SCOPE_OBJECT_TYPES], [...clientIds]);
  }
  return clauses.length === 0 ? { sql: 'TRUE', bindings: [] } : { sql: clauses.join(' AND '), bindings };
}

/** The internal principal's organization when it is not owning-tenant staff; undefined when no audience restriction applies. */
function restrictedAudienceReader(user: SearchAclPrincipal): CommentAudienceReader | null | undefined {
  if (!user.isInternal || user.audienceReader === undefined || user.audienceReader?.kind === 'staff') return undefined;
  return user.audienceReader;
}

/**
 * Comment-audience predicate over the index. The indexer stores each comment's audience
 * (`metadata.audience`) and its ticket's client (`client_scope_id`); a seat technician reads the
 * audiences the shared predicate admits, on their own client only. A row with no stored audience
 * fails closed. Non-staff client readers are already bounded by `is_internal_only`.
 */
function commentAudienceIndexSql(user: SearchAclPrincipal): SqlFragment {
  const reader = restrictedAudienceReader(user);
  if (reader === undefined) return { sql: 'TRUE', bindings: [] };
  if (reader?.kind !== 'seat') return { sql: `(object_type <> 'ticket_comment')`, bindings: [] };
  return {
    sql: `(object_type <> 'ticket_comment' OR (metadata->>'audience' = ANY(?::text[]) AND client_scope_id = ?::uuid))`,
    bindings: [audiencesVisibleTo('seat'), reader.clientId],
  };
}

export function aclPredicateSql(user: SearchAclPrincipal): SqlFragment {
  const clientAccess = user.clientAccess ?? { mode: 'all' };
  const clientScope = clientScopeSql(clientAccess);
  const commentAudience = commentAudienceIndexSql(user);

  const boardIds = clientAccess.boardIds;
  // `s` is the search index alias every query in query.ts uses. The correlated reads are tenant-joined.
  const boardClause = boardIds === undefined
    ? 'TRUE'
    : `(
          NOT (s.object_type = ANY(?::text[]))
          OR EXISTS (
            SELECT 1
              FROM tickets board_t
             WHERE board_t.tenant = s.tenant
               AND board_t.board_id = ANY(?::uuid[])
               AND (
                 (s.object_type = 'ticket' AND board_t.ticket_id::text = s.object_id)
                 OR (
                   s.object_type = 'ticket_comment'
                   AND EXISTS (
                     SELECT 1
                       FROM comments board_c
                      WHERE board_c.tenant = s.tenant
                        AND board_c.ticket_id = board_t.ticket_id
                        AND board_c.comment_id::text = s.object_id
                   )
                 )
               )
          )
        )`;
  const boardBindings = boardIds === undefined ? [] : [[...BOARD_SCOPED_OBJECT_TYPES], boardIds];

  return {
    sql: `
      (
        (required_permission IS NULL OR required_permission = ANY(?::text[]))
        AND (cardinality(visible_to_user_ids) = 0 OR visible_to_user_ids && ARRAY[?]::uuid[])
        AND (cardinality(visible_to_roles) = 0 OR visible_to_roles && ?::text[])
        AND (is_internal_only = false OR ?::boolean = true)
        AND (is_private = false OR visible_to_user_ids && ARRAY[?]::uuid[])
        AND ${clientScope.sql}
        AND ${commentAudience.sql}
        AND ${boardClause}
      )
    `,
    bindings: [
      user.permissions,
      user.userId,
      user.roles ?? [],
      user.isInternal ?? false,
      user.userId,
      ...clientScope.bindings,
      ...commentAudience.bindings,
      ...boardBindings,
    ],
  };
}

export async function resolveSearchAclPrincipal(
  knex: Knex,
  user: Pick<IUserWithRoles, 'user_id' | 'user_type' | 'tenant'> & { seat_reader?: boolean | null },
  clientAccess: ClientAccess,
): Promise<SearchAclPrincipal> {
  const rolesWithPermissions = await User.getUserRolesWithPermissions(knex, user.user_id);
  const isClientPortal = isClientUserType(user.user_type);
  const isMspPrincipal = isMspPrincipalUserType(user.user_type);
  const permissions = new Set<string>();
  const roles = new Set<string>();

  for (const role of rolesWithPermissions) {
    if (isClientPortal && !role.client) continue;
    if (!isClientPortal && !(isMspPrincipal && role.msp)) continue;

    roles.add(role.role_name);

    for (const permission of role.permissions) {
      if (isClientPortal && !permission.client) continue;
      if (!isClientPortal && !(isMspPrincipal && permission.msp)) continue;
      permissions.add(`${permission.resource}:${permission.action}`);
    }
  }

  return {
    userId: user.user_id,
    tenant: user.tenant,
    permissions: [...permissions],
    roles: [...roles],
    isInternal: !isClientPortal,
    clientAccess,
    // A client user is the requester and an internal user whose loaded row says no seat
    // assignment binds them is staff, both with no SQL; otherwise one read of the seat tables.
    audienceReader: user.tenant
      ? await admitCommentAudienceReader(knex, user.tenant, { userId: user.user_id, userType: isClientPortal ? 'client' : 'internal', seatReader: user.seat_reader })
      : undefined,
  };
}

export function registerSearchVisibilityVerifier(
  objectType: SearchObjectType,
  verifier: SearchVisibilityVerifier,
): void {
  visibilityVerifiers.set(objectType, verifier);
}

export async function verifyResultVisibility<TRow extends SearchVisibilityRow>(
  knex: Knex,
  user: SearchAclPrincipal,
  rows: TRow[],
): Promise<TRow[]> {
  const visibleRows: TRow[] = [];

  for (const row of rows) {
    const verifier = visibilityVerifiers.get(row.type);
    if (!verifier) {
      visibleRows.push(row);
      continue;
    }

    if (await verifier(knex, user, row)) {
      visibleRows.push(row);
    } else {
      emitAclDrift(row, user);
    }
  }

  return visibleRows;
}

function hasClientAccess(user: SearchAclPrincipal, objectType: SearchObjectType, clientId: string | null | undefined): boolean {
  const allowed = clientIdsForObjectType(user.clientAccess, objectType);
  if (allowed === null) return true;
  if (!clientId) return !STRICT_CLIENT_SCOPE_OBJECT_TYPES.includes(objectType);
  return allowed.includes(clientId);
}

function parseAssignedUsers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        const id = record.user_id ?? record.userId ?? record.id;
        return typeof id === 'string' ? id : undefined;
      }
      return undefined;
    })
    .filter((entry): entry is string => Boolean(entry));
}

function tenantScopedRoot<Row extends object>(
  knex: Knex,
  user: SearchAclPrincipal,
  tableExpression: string,
): Knex.QueryBuilder<Row, Row[]> {
  if (!user.tenant) {
    return tenantDb(knex, SEARCH_ACL_MISSING_TENANT)
      .unscoped<Row>(tableExpression, SEARCH_ACL_MISSING_TENANT_REASON)
      .whereRaw('1 = 0');
  }

  return tenantDb(knex, user.tenant).table<Row>(tableExpression);
}

/** The live audience check: the shared predicate for `reader`, over the comment as stored now. */
async function commentVisibleToReader(knex: Knex, user: SearchAclPrincipal, commentId: string, reader: CommentAudienceReader | null): Promise<boolean> {
  if (!reader || !user.tenant) return false;
  const query = tenantScopedRoot<{ audience: string | null; client_id: string | null }>(knex, user, 'comments as c');
  const scoped = tenantDb(knex, user.tenant);
  scoped.tenantJoin(query, 'comment_threads as ct', 'ct.thread_id', 'c.thread_id', { type: 'left' });
  scoped.tenantJoin(query, 'comments as rc', 'rc.comment_id', 'ct.root_comment_id', { type: 'left' });
  scoped.tenantJoin(query, 'tickets as t', 't.ticket_id', 'c.ticket_id', { type: 'left' });
  const found = await query
    .select('t.client_id', knex.raw('(?) as audience', [commentAudienceSql(knex, 'ct', 'rc', 'c')]) as unknown as string)
    .where('c.comment_id', commentId)
    .first();
  return isCommentAudience(found?.audience)
    && isCommentAudienceVisible(found.audience, { tenant: user.tenant, clientId: found.client_id }, reader);
}

/**
 * Strict client-scope check for tickets. Unlike `hasClientAccess` (null client = tenant-wide for
 * most entity types), a ticket with no client is never visible to a scoped principal: the
 * principal can only prove access to a client it is scoped to. Fails closed for legacy index rows
 * whose `client_scope_id` is NULL.
 */
function hasTicketClientAccess(
  user: SearchAclPrincipal,
  objectType: 'ticket' | 'ticket_comment',
  clientId: string | null | undefined,
): boolean {
  return hasClientAccess(user, objectType, clientId);
}

// LEVERAGE: friction portal-ticket-policy-in-search — the canonical portal policy (board visibility
// groups, contact-scoped tickets: ticketMatchesVisibility / getClientContactVisibilityContext in
// @alga-psa/authorization) is not enforced here: SearchAclPrincipal carries no contact context and
// the resolver needs a transaction. Only client scope is enforced for ticket search.
async function ticketVisibleToPrincipal(
  knex: Knex,
  user: SearchAclPrincipal,
  objectType: 'ticket' | 'ticket_comment',
  ticketId: string,
): Promise<boolean> {
  const row = await tenantScopedRoot<{ ticket_id: string; client_id: string | null; board_id: string | null }>(knex, user, 'tickets')
    .select('ticket_id', 'client_id', 'board_id')
    .where('ticket_id', ticketId)
    .first();
  if (!row) return false;
  const boardIds = user.clientAccess?.boardIds;
  if (boardIds !== undefined && !(row.board_id && boardIds.includes(row.board_id))) return false;
  return hasTicketClientAccess(user, objectType, row.client_id);
}

async function projectClientIdForProject(
  knex: Knex,
  user: SearchAclPrincipal,
  projectId: string,
): Promise<string | null | undefined> {
  const row = await tenantScopedRoot<{ client_id: string | null }>(knex, user, 'projects')
    .select('client_id')
    .where('project_id', projectId)
    .first();
  return row?.client_id;
}

registerSearchVisibilityVerifier('ticket', async (knex, user, row) => {
  return ticketVisibleToPrincipal(knex, user, 'ticket', row.id);
});

registerSearchVisibilityVerifier('ticket_comment', async (knex, user, row) => {
  const comment = await tenantScopedRoot<{ ticket_id: string; is_internal: boolean | null }>(
    knex,
    user,
    'comments',
  )
    .select('ticket_id', 'is_internal')
    .where('comment_id', row.id)
    .whereNull('deleted_at')
    .where('publish_state', 'published')
    .first();
  if (!comment) return false;
  if (comment.is_internal && !user.isInternal) return false;
  // Audience is an additional restriction on non-staff readers (staff of the owning tenant see
  // every audience stored there). It uses the same predicate as the indexer and portal reads, so
  // a public-flagged comment on a private thread cannot be reached through search.
  // A seat technician is an internal user and still not that staff: the same predicate, read as
  // their organization, keeps private notes (legacy internal notes included) out of their search.
  const reader = user.isInternal ? restrictedAudienceReader(user) : user.tenant ? { kind: 'requester' as const, tenant: user.tenant } : null;
  if (reader !== undefined && !(await commentVisibleToReader(knex, user, row.id, reader))) return false;
  return ticketVisibleToPrincipal(knex, user, 'ticket_comment', comment.ticket_id);
});

registerSearchVisibilityVerifier('project', async (knex, user, row) => {
  const clientId = await projectClientIdForProject(knex, user, row.id);
  return clientId !== undefined && hasClientAccess(user, 'project', clientId);
});

registerSearchVisibilityVerifier('project_phase', async (knex, user, row) => {
  const phase = await tenantScopedRoot<{ project_id: string }>(knex, user, 'project_phases')
    .select('project_id')
    .where('phase_id', row.id)
    .first();
  if (!phase) return false;
  const clientId = await projectClientIdForProject(knex, user, phase.project_id);
  return clientId !== undefined && hasClientAccess(user, 'project_phase', clientId);
});

registerSearchVisibilityVerifier('project_task', async (knex, user, row) => {
  if (!user.tenant) return false;

  const db = tenantDb(knex, user.tenant);
  const query = db.table<{ project_id: string }>('project_tasks as pt')
    .select('pp.project_id')
    .where('pt.task_id', row.id)
    .first();
  db.tenantJoin(query, 'project_phases as pp', 'pp.phase_id', 'pt.phase_id');

  const task = await query;
  if (!task) return false;
  const clientId = await projectClientIdForProject(knex, user, task.project_id);
  return clientId !== undefined && hasClientAccess(user, 'project_task', clientId);
});

registerSearchVisibilityVerifier('project_task_comment', async (knex, user, row) => {
  if (!user.tenant) return false;

  const db = tenantDb(knex, user.tenant);
  const query = db.table<{ project_id: string }>('project_task_comments as ptc')
    .select('pp.project_id')
    .where('ptc.task_comment_id', row.id)
    .whereNull('ptc.deleted_at')
    .first();
  db.tenantJoin(query, 'project_tasks as pt', 'pt.task_id', 'ptc.task_id');
  db.tenantJoin(query, 'project_phases as pp', 'pp.phase_id', 'pt.phase_id');

  const comment = await query;
  if (!comment) return false;
  const clientId = await projectClientIdForProject(knex, user, comment.project_id);
  return clientId !== undefined && hasClientAccess(user, 'project_task_comment', clientId);
});

/**
 * Client-owned types: a narrowed principal must prove the record's client from the source, with the
 * same manifest-driven resolution the indexers use, so a row whose index scope is stale or missing
 * cannot be reached. Unrestricted principals skip it (no query).
 */
async function clientOwnedRecordVisible(
  knex: Knex,
  user: SearchAclPrincipal,
  objectType: ClientScopedObjectType,
  objectId: string,
): Promise<boolean> {
  const allowed = clientIdsForObjectType(user.clientAccess, objectType);
  if (allowed === null) return true;
  if (!user.tenant) return false;
  const scope = (await resolveClientScopes(knex, user.tenant, objectType, [objectId])).get(objectId) ?? null;
  return scope !== null && allowed.includes(scope);
}

for (const objectType of ['client', 'contact', 'interaction', 'time_entry'] as const) {
  registerSearchVisibilityVerifier(objectType, (knex, user, row) =>
    clientOwnedRecordVisible(knex, user, objectType, row.id));
}

registerSearchVisibilityVerifier('document', async (knex, user, row) => {
  const document = await tenantScopedRoot<{ document_id: string }>(knex, user, 'documents')
    .select('document_id')
    .where('document_id', row.id)
    .first();
  if (!document) return false;
  return clientOwnedRecordVisible(knex, user, 'document', row.id);
});

registerSearchVisibilityVerifier('workflow_task', async (knex, user, row) => {
  const task = await tenantScopedRoot<{ assigned_users: unknown }>(knex, user, 'workflow_tasks')
    .select('assigned_users')
    .where('task_id', row.id)
    .first();
  if (!task) return false;

  const assignedUsers = parseAssignedUsers(task.assigned_users);
  return assignedUsers.length === 0 || assignedUsers.includes(user.userId);
});

// Statuses are tenant-wide reference data. The SQL layer already enforces the
// required_permission gate; this record-level check drops rows whose source
// status was removed (defence-in-depth against a missed STATUS_DELETED event,
// e.g. from a bulk seeding path that does not publish per-status events).
registerSearchVisibilityVerifier('status', async (knex, user, row) => {
  // Status search rows are keyed by name (ticket statuses only, deduped
  // across boards), so the existence check matches on name, not status_id.
  const status = await tenantScopedRoot<{ name: string }>(knex, user, 'statuses')
    .select('name')
    .where('name', row.id)
    .andWhere('status_type', 'ticket')
    .first();
  return Boolean(status);
});
