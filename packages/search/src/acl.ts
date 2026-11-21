import { isClientUserType, isMspPrincipalUserType } from '@alga-psa/types';
import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import User from '@alga-psa/db/models/user';
import type { IUserWithRoles } from '@alga-psa/types';
import type { Knex } from 'knex';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import {
  applyTicketReadAuthorizationSql,
  authorizeTicketRecordBatch,
  createTicketAuthorizationContext,
  type TicketAuthorizationContext,
} from '@alga-psa/tickets/lib/ticketRecordAuthorization';

import type { AclMetadata, SearchObjectType } from '@alga-psa/types';

export interface ComposedAclHints {
  visibleToUserIds: string[];
  visibleToRoles: string[];
  isInternalOnly: boolean;
  isPrivate: boolean;
  clientScopeId?: string;
  requiredPermission?: string;
}

/**
 * Client visibility for a search principal. `all` means unrestricted (today:
 * every internal/MSP user). `scoped` means the principal may only see rows
 * whose `client_scope_id` is in `clientIds` (client-portal users now; the seam
 * for future ABAC per-internal-user client restrictions). Keeping this an
 * explicit mode — rather than overloading an empty array — is what lets a
 * future restriction be a single change in the resolver without the SQL
 * predicate and per-row verifier disagreeing.
 */
export type ClientAccess =
  | { mode: 'all' }
  | { mode: 'scoped'; clientIds: string[] };

export interface SearchAclPrincipal {
  userId: string;
  tenant?: string;
  permissions: string[];
  roles?: string[];
  isInternal?: boolean;
  clientAccess: ClientAccess;
  /** Authenticated identity used by the shared ticket record policy. */
  authorizationUser?: IUserWithRoles;
  ticketVisibilitySql?: SqlFragment;
  ticketPolicySqlSupported?: boolean;
  ticketAuthorizationResolutionFailed?: boolean;
  ticketAuthorizationContext?: TicketAuthorizationContext;
  recordVisibilitySql?: SqlFragment;
}

export interface SqlFragment {
  sql: string;
  bindings: unknown[];
}

/**
 * Source-record checks that can be expressed as correlated predicates over the
 * indexed candidate. A compiler is attached to its verifier registration, so
 * replacing a verifier without a matching compiler automatically selects the
 * verified fallback path.
 */
type SearchVisibilitySqlCompiler = (user: SearchAclPrincipal) => SqlFragment;
interface SearchVisibilityRegistration {
  verifier: SearchVisibilityVerifier;
  sqlCompiler?: SearchVisibilitySqlCompiler;
}

export function canCompileSearchVisibility(type: SearchObjectType): boolean {
  const registration = visibilityVerifiers.get(type);
  // Types with no source-record verifier rely on the shared index ACL, which
  // already supports exact counts and bounded pages in SQL. A registered
  // verifier must have a matching compiler or it stays on the verifier scan.
  return registration ? Boolean(registration.sqlCompiler) : true;
}

function compileRecordVisibilitySql(user: SearchAclPrincipal, onlyType: SearchObjectType): SqlFragment {
  if (!user.tenant) return { sql: 'FALSE', bindings: [] };
  const scopedClientIds = user.clientAccess.mode === 'scoped' ? user.clientAccess.clientIds : undefined;
  const clientAllowed = (alias: string) => scopedClientIds
    ? `(${alias}.client_id IS NULL OR ${alias}.client_id = ANY(?::uuid[]))`
    : 'TRUE';
  const projectExists = (projectId: string) => `EXISTS (
    SELECT 1 FROM projects p
    WHERE p.tenant = ?::uuid AND p.project_id::text = ${projectId}
      AND ${clientAllowed('p')}
  )`;
  const projectJoin = `EXISTS (
    SELECT 1 FROM projects p
    WHERE p.tenant = ?::uuid AND p.project_id = pp.project_id
      AND ${clientAllowed('p')}
  )`;
  const assignedUserId = `(CASE
    WHEN jsonb_typeof(assignee) = 'string' THEN nullif(assignee #>> '{}', '')
    WHEN jsonb_typeof(assignee) = 'object' THEN CASE
      WHEN jsonb_typeof(assignee->'user_id') IS NOT NULL AND jsonb_typeof(assignee->'user_id') <> 'null'
        THEN CASE WHEN jsonb_typeof(assignee->'user_id') = 'string' THEN nullif(assignee->>'user_id', '') END
      WHEN jsonb_typeof(assignee->'userId') IS NOT NULL AND jsonb_typeof(assignee->'userId') <> 'null'
        THEN CASE WHEN jsonb_typeof(assignee->'userId') = 'string' THEN nullif(assignee->>'userId', '') END
      WHEN jsonb_typeof(assignee->'id') = 'string' THEN nullif(assignee->>'id', '')
    END
  END)`;
  const types: Array<{ type: SearchObjectType; sql: string; clientBinding?: boolean }> = [
    { type: 'project', sql: projectExists('s.object_id'), clientBinding: true },
    { type: 'project_phase', sql: `EXISTS (
      SELECT 1 FROM project_phases pp
      WHERE pp.tenant = ?::uuid AND pp.phase_id::text = s.object_id
        AND ${projectJoin}
    )`, clientBinding: true },
    { type: 'project_task', sql: `EXISTS (
      SELECT 1 FROM project_tasks pt
      JOIN project_phases pp ON pp.tenant = pt.tenant AND pp.phase_id = pt.phase_id
      WHERE pt.tenant = ?::uuid AND pt.task_id::text = s.object_id
        AND ${projectJoin}
    )`, clientBinding: true },
    { type: 'project_task_comment', sql: `EXISTS (
      SELECT 1 FROM project_task_comments ptc
      JOIN project_tasks pt ON pt.tenant = ptc.tenant AND pt.task_id = ptc.task_id
      JOIN project_phases pp ON pp.tenant = pt.tenant AND pp.phase_id = pt.phase_id
      WHERE ptc.tenant = ?::uuid AND ptc.task_comment_id::text = s.object_id
        AND ptc.deleted_at IS NULL AND ${projectJoin}
    )`, clientBinding: true },
    { type: 'workflow_task', sql: `EXISTS (
      SELECT 1 FROM workflow_tasks wt
      WHERE wt.tenant = ?::uuid AND wt.task_id::text = s.object_id
        AND CASE WHEN jsonb_typeof(wt.assigned_users) = 'array' THEN (
          jsonb_array_length(wt.assigned_users) = 0 OR NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(wt.assigned_users) assignee
            WHERE ${assignedUserId} IS NOT NULL
          ) OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(wt.assigned_users) assignee
            WHERE ${assignedUserId} = ?
          )
        ) ELSE TRUE END
    )` },
    { type: 'status', sql: `EXISTS (
      SELECT 1 FROM statuses st
      WHERE st.tenant = ?::uuid AND st.name = s.object_id AND st.status_type = 'ticket'
    )` },
  ];
  const bindings: unknown[] = [];
  const predicates = types.filter(({ type }) => type === onlyType).map(({ type, sql, clientBinding }) => {
    bindings.push(user.tenant);
    if (type === 'workflow_task') {
      bindings.push(user.userId);
    } else {
      if (['project_phase', 'project_task', 'project_task_comment'].includes(type)) bindings.push(user.tenant);
      if (clientBinding && scopedClientIds) bindings.push(scopedClientIds);
    }
    return `(${sql})`;
  });
  return { sql: predicates[0] ?? 'FALSE', bindings };
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

const visibilityVerifiers = new Map<SearchObjectType, SearchVisibilityRegistration>();
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

export function aclPredicateSql(user: SearchAclPrincipal): SqlFragment {
  const clientAccess = user.clientAccess ?? { mode: 'all' };
  const clientScopeClause = clientAccess.mode === 'all'
    ? 'TRUE'
    : '(client_scope_id IS NULL OR client_scope_id = ANY(?::uuid[]))';
  const clientScopeBindings = clientAccess.mode === 'all'
    ? []
    : [clientAccess.clientIds];

  return {
    sql: `
      (
        (required_permission IS NULL OR required_permission = ANY(?::text[]))
        AND (cardinality(visible_to_user_ids) = 0 OR visible_to_user_ids && ARRAY[?]::uuid[])
        AND (cardinality(visible_to_roles) = 0 OR visible_to_roles && ?::text[])
        AND (is_internal_only = false OR ?::boolean = true)
        AND (is_private = false OR visible_to_user_ids && ARRAY[?]::uuid[])
        AND ${clientScopeClause}
      )
    `,
    bindings: [
      user.permissions,
      user.userId,
      user.roles ?? [],
      user.isInternal ?? false,
      user.userId,
      ...clientScopeBindings,
    ],
  };
}

export async function resolveSearchAclPrincipal(
  knex: Knex,
  user: IUserWithRoles,
  clientAccess: ClientAccess = { mode: 'all' },
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

  const principal: SearchAclPrincipal = {
    userId: user.user_id,
    tenant: user.tenant,
    permissions: [...permissions],
    roles: [...roles],
    isInternal: !isClientPortal,
    clientAccess,
    authorizationUser: user,
  };
  const compiledRecordPredicates = [...visibilityVerifiers.entries()]
    .filter(([, registration]) => registration.sqlCompiler)
    .map(([type, registration]) => {
      const fragment = registration.sqlCompiler!(principal);
      return { sql: `(s.object_type <> ? OR ${fragment.sql})`, bindings: [type, ...fragment.bindings] };
    });
  principal.recordVisibilitySql = {
    sql: compiledRecordPredicates.map(({ sql }) => sql).join(' AND ') || 'TRUE',
    bindings: compiledRecordPredicates.flatMap(({ bindings }) => bindings),
  };

  if (user.tenant && [...permissions].includes('ticket:read')) {
    let context: Awaited<ReturnType<typeof createTicketAuthorizationContext>>;
    try {
      context = await createTicketAuthorizationContext(knex, user.tenant, user);
    } catch {
      principal.ticketPolicySqlSupported = false;
      principal.ticketAuthorizationResolutionFailed = true;
      return principal;
    }
    principal.ticketAuthorizationContext = context;
    const ticketQuery = tenantDb(knex, user.tenant).scoped('tickets as t');
    // Search indexes store identifiers as text while source identifiers are UUIDs.
    // Guard the cast so unrelated mixed-search IDs remain harmless.
    ticketQuery.builder.whereRaw(
      `t.ticket_id = CASE WHEN s.object_id ~* ? THEN s.object_id::uuid END`,
      ['^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'],
    );
    const ticketCompiled = applyTicketReadAuthorizationSql(ticketQuery, knex, user.tenant, context);
    if (!ticketCompiled.supported) {
      principal.ticketPolicySqlSupported = false;
      return principal;
    }

    const parentTicketQuery = tenantDb(knex, user.tenant).scoped('tickets as t');
    parentTicketQuery.builder.whereRaw('t.ticket_id = c.ticket_id');
    const parentCompiled = applyTicketReadAuthorizationSql(parentTicketQuery, knex, user.tenant, context);
    if (!parentCompiled.supported) {
      principal.ticketPolicySqlSupported = false;
      return principal;
    }

    const commentQuery = tenantDb(knex, user.tenant).table('comments as c');
    const scoped = tenantDb(knex, user.tenant);
    scoped.tenantJoin(commentQuery, 'comment_threads as ct', 'ct.thread_id', 'c.thread_id', { type: 'left' });
    scoped.tenantJoin(commentQuery, 'comments as rc', 'rc.comment_id', 'ct.root_comment_id', { type: 'left' });
    commentQuery
      .select('c.comment_id')
      .whereRaw(
        `c.comment_id = CASE WHEN s.object_id ~* ? THEN s.object_id::uuid END`,
        ['^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'],
      )
      .whereNull('c.deleted_at')
      .where('c.publish_state', 'published');
    if (!principal.isInternal) {
      commentQuery.where('c.is_internal', false)
        .whereRaw('(?) = ?', [commentAudienceSql(knex, 'ct', 'rc', 'c'), 'requester']);
    }
    commentQuery.whereExists(parentTicketQuery.builder);

    const ticketSql = ticketQuery.builder.toSQL();
    const commentSql = commentQuery.toSQL();
    principal.ticketVisibilitySql = {
      sql: `((s.object_type <> 'ticket' OR EXISTS (${ticketSql.sql})) AND (s.object_type <> 'ticket_comment' OR EXISTS (${commentSql.sql})))`,
      bindings: [...ticketSql.bindings, ...commentSql.bindings],
    };
    principal.ticketPolicySqlSupported = true;
  }

  return principal;
}

export function registerSearchVisibilityVerifier(
  objectType: SearchObjectType,
  verifier: SearchVisibilityVerifier,
  sqlCompiler?: SearchVisibilitySqlCompiler,
): () => void {
  const previous = visibilityVerifiers.get(objectType);
  const registration: SearchVisibilityRegistration = { verifier, sqlCompiler };
  visibilityVerifiers.set(objectType, registration);
  return () => {
    if (visibilityVerifiers.get(objectType) !== registration) return;
    if (previous) visibilityVerifiers.set(objectType, previous);
    else visibilityVerifiers.delete(objectType);
  };
}

function registerCompiledSearchVisibilityVerifier(
  objectType: SearchObjectType,
  verifier: SearchVisibilityVerifier,
): void {
  registerSearchVisibilityVerifier(
    objectType,
    verifier,
    (user) => compileRecordVisibilitySql(user, objectType),
  );
}

export async function verifyResultVisibility<TRow extends SearchVisibilityRow>(
  knex: Knex,
  user: SearchAclPrincipal,
  rows: TRow[],
): Promise<TRow[]> {
  const ticketRows = rows.filter((row) => row.type === 'ticket');
  const commentRows = rows.filter((row) => row.type === 'ticket_comment');
  const commentById = new Map<string, { ticket_id: string; is_internal: boolean | null; audience: string | null }>();

  if (user.tenant && user.authorizationUser && commentRows.length > 0) {
    const query = tenantScopedRoot<{ comment_id: string; ticket_id: string; is_internal: boolean | null; audience: string | null }>(
      knex, user, 'comments as c',
    );
    const scoped = tenantDb(knex, user.tenant);
    scoped.tenantJoin(query, 'comment_threads as ct', 'ct.thread_id', 'c.thread_id', { type: 'left' });
    scoped.tenantJoin(query, 'comments as rc', 'rc.comment_id', 'ct.root_comment_id', { type: 'left' });
    const loadedComments = await query
      .select('c.comment_id', 'c.ticket_id', 'c.is_internal')
      .select(knex.raw('(?) as audience', [commentAudienceSql(knex, 'ct', 'rc', 'c')]) as unknown as string)
      .whereIn('c.comment_id', commentRows.map((row) => row.id))
      .whereNull('c.deleted_at')
      .where('c.publish_state', 'published');
    const commentRecords = Array.isArray(loadedComments) ? loadedComments : loadedComments ? [loadedComments] : [];
    for (const comment of commentRecords) commentById.set(comment.comment_id, comment);
  }

  const parentTicketIds = [
    ...ticketRows.map((row) => row.id),
    ...Array.from(commentById.values())
      .filter((comment) => (!comment.is_internal || user.isInternal) && (user.isInternal || comment.audience === 'requester'))
      .map((comment) => comment.ticket_id),
  ];
  let authorizedTicketIds = new Set<string>();
  if (!user.ticketAuthorizationResolutionFailed && user.tenant && user.authorizationUser && parentTicketIds.length > 0) {
    try {
      authorizedTicketIds = await authorizeTicketRecordBatch({
        trx: knex,
        tenant: user.tenant,
        user: user.authorizationUser,
        ticketIds: parentTicketIds,
        context: user.ticketAuthorizationContext,
      });
    } catch {
      // Policy resolution and record loading failures deny the whole ticket batch.
      authorizedTicketIds = new Set();
    }
  }

  const visibleRows: TRow[] = [];

  for (const row of rows) {
    if (row.type === 'ticket') {
      if (authorizedTicketIds.has(row.id)) visibleRows.push(row);
      else emitAclDrift(row, user);
      continue;
    }
    if (row.type === 'ticket_comment') {
      const comment = commentById.get(row.id);
      const allowed = Boolean(comment && (!comment.is_internal || user.isInternal) &&
        (user.isInternal || comment.audience === 'requester') && authorizedTicketIds.has(comment.ticket_id));
      if (allowed) visibleRows.push(row);
      else emitAclDrift(row, user);
      continue;
    }
    const registration = visibilityVerifiers.get(row.type);
    if (!registration) {
      visibleRows.push(row);
      continue;
    }

    if (await registration.verifier(knex, user, row)) {
      visibleRows.push(row);
    } else {
      emitAclDrift(row, user);
    }
  }

  return visibleRows;
}

function hasClientAccess(user: SearchAclPrincipal, clientId: string | null | undefined): boolean {
  if (!clientId) {
    return true;
  }
  const clientAccess = user.clientAccess ?? { mode: 'all' };
  if (clientAccess.mode === 'all') {
    return true;
  }
  return clientAccess.clientIds.includes(clientId);
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

registerCompiledSearchVisibilityVerifier('project', async (knex, user, row) => {
  const clientId = await projectClientIdForProject(knex, user, row.id);
  return clientId !== undefined && hasClientAccess(user, clientId);
});

registerCompiledSearchVisibilityVerifier('project_phase', async (knex, user, row) => {
  const phase = await tenantScopedRoot<{ project_id: string }>(knex, user, 'project_phases')
    .select('project_id')
    .where('phase_id', row.id)
    .first();
  if (!phase) return false;
  const clientId = await projectClientIdForProject(knex, user, phase.project_id);
  return clientId !== undefined && hasClientAccess(user, clientId);
});

registerCompiledSearchVisibilityVerifier('project_task', async (knex, user, row) => {
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
  return clientId !== undefined && hasClientAccess(user, clientId);
});

registerCompiledSearchVisibilityVerifier('project_task_comment', async (knex, user, row) => {
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
  return clientId !== undefined && hasClientAccess(user, clientId);
});

registerSearchVisibilityVerifier('document', async (knex, user, row) => {
  const document = await tenantScopedRoot<{ document_id: string }>(knex, user, 'documents')
    .select('document_id')
    .where('document_id', row.id)
    .first();
  if (!document) return false;

  const associations = await tenantScopedRoot<{ entity_id: string }>(
    knex,
    user,
    'document_associations',
  )
    .select('entity_id')
    .where('document_id', row.id)
    .andWhere('entity_type', 'client');
  // Treat every client association as a visibility constraint. Using any()
  // grants access when one linked client is allowed but another is denied;
  // the old first-row check had no deterministic database ordering either.
  return associations.length === 0 || associations.every(({ entity_id }) => hasClientAccess(user, entity_id));
});

registerCompiledSearchVisibilityVerifier('workflow_task', async (knex, user, row) => {
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
registerCompiledSearchVisibilityVerifier('status', async (knex, user, row) => {
  // Status search rows are keyed by name (ticket statuses only, deduped
  // across boards), so the existence check matches on name, not status_id.
  const status = await tenantScopedRoot<{ name: string }>(knex, user, 'statuses')
    .select('name')
    .where('name', row.id)
    .andWhere('status_type', 'ticket')
    .first();
  return Boolean(status);
});
