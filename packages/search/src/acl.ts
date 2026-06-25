import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import User from '@alga-psa/db/models/user';
import type { IUserWithRoles } from '@alga-psa/types';
import type { Knex } from 'knex';

import type { AclMetadata, SearchObjectType } from '@alga-psa/types';

const RESOURCE_CANONICAL_MAP: Record<string, string> = {
  timeentry: 'time_entry',
  time_entry: 'time_entry',
  timesheet: 'time_sheet',
  time_sheet: 'time_sheet',
};

function canonicalizeResource(resource: string): string {
  return RESOURCE_CANONICAL_MAP[resource] ?? resource;
}

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
  user: Pick<IUserWithRoles, 'user_id' | 'user_type' | 'tenant'>,
  clientAccess: ClientAccess = { mode: 'all' },
): Promise<SearchAclPrincipal> {
  const rolesWithPermissions = await User.getUserRolesWithPermissions(knex, user.user_id);
  const isClientPortal = user.user_type === 'client';
  const permissions = new Set<string>();
  const roles = new Set<string>();

  for (const role of rolesWithPermissions) {
    if (isClientPortal && !role.client) continue;
    if (!isClientPortal && !role.msp) continue;

    roles.add(role.role_name);

    for (const permission of role.permissions) {
      if (isClientPortal && !permission.client) continue;
      if (!isClientPortal && !permission.msp) continue;
      permissions.add(`${canonicalizeResource(permission.resource)}:${permission.action}`);
    }
  }

  return {
    userId: user.user_id,
    tenant: user.tenant,
    permissions: [...permissions],
    roles: [...roles],
    isInternal: !isClientPortal,
    clientAccess,
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
    return knex<Row, Row[]>(tableExpression);
  }

  return tenantDb(knex, user.tenant).table<Row>(tableExpression);
}

async function ticketExists(knex: Knex, user: SearchAclPrincipal, ticketId: string): Promise<boolean> {
  const row = await tenantScopedRoot<{ ticket_id: string }>(knex, user, 'tickets')
    .select('ticket_id')
    .where('ticket_id', ticketId)
    .first();
  return Boolean(row);
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
  return ticketExists(knex, user, row.id);
});

registerSearchVisibilityVerifier('ticket_comment', async (knex, user, row) => {
  const comment = await tenantScopedRoot<{ ticket_id: string; is_internal: boolean | null }>(
    knex,
    user,
    'comments',
  )
    .select('ticket_id', 'is_internal')
    .where('comment_id', row.id)
    .first();
  if (!comment) return false;
  if (comment.is_internal && !user.isInternal) return false;
  return ticketExists(knex, user, comment.ticket_id);
});

registerSearchVisibilityVerifier('project', async (knex, user, row) => {
  const clientId = await projectClientIdForProject(knex, user, row.id);
  return clientId !== undefined && hasClientAccess(user, clientId);
});

registerSearchVisibilityVerifier('project_phase', async (knex, user, row) => {
  const phase = await tenantScopedRoot<{ project_id: string }>(knex, user, 'project_phases')
    .select('project_id')
    .where('phase_id', row.id)
    .first();
  if (!phase) return false;
  const clientId = await projectClientIdForProject(knex, user, phase.project_id);
  return clientId !== undefined && hasClientAccess(user, clientId);
});

registerSearchVisibilityVerifier('project_task', async (knex, user, row) => {
  const query = tenantScopedRoot<{ project_id: string }>(knex, user, 'project_tasks as pt')
    .select('pp.project_id')
    .where('pt.task_id', row.id)
    .first();
  if (user.tenant) {
    tenantDb(knex, user.tenant).tenantJoin(query, 'project_phases as pp', 'pp.phase_id', 'pt.phase_id');
  } else {
    query.join('project_phases as pp', function() {
      this.on('pp.phase_id', 'pt.phase_id').andOn('pp.tenant', 'pt.tenant');
    });
  }
  const task = await query;
  if (!task) return false;
  const clientId = await projectClientIdForProject(knex, user, task.project_id);
  return clientId !== undefined && hasClientAccess(user, clientId);
});

registerSearchVisibilityVerifier('project_task_comment', async (knex, user, row) => {
  const query = tenantScopedRoot<{ project_id: string }>(knex, user, 'project_task_comments as ptc')
    .select('pp.project_id')
    .where('ptc.task_comment_id', row.id)
    .first();
  if (user.tenant) {
    const db = tenantDb(knex, user.tenant);
    db.tenantJoin(query, 'project_tasks as pt', 'pt.task_id', 'ptc.task_id');
    db.tenantJoin(query, 'project_phases as pp', 'pp.phase_id', 'pt.phase_id');
  } else {
    query
      .join('project_tasks as pt', function() {
        this.on('pt.task_id', 'ptc.task_id').andOn('pt.tenant', 'ptc.tenant');
      })
      .join('project_phases as pp', function() {
        this.on('pp.phase_id', 'pt.phase_id').andOn('pp.tenant', 'pt.tenant');
      });
  }
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

  const association = await tenantScopedRoot<{ entity_id: string }>(
    knex,
    user,
    'document_associations',
  )
    .select('entity_id')
    .where('document_id', row.id)
    .andWhere('entity_type', 'client')
    .first();
  return hasClientAccess(user, association?.entity_id ?? null);
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
