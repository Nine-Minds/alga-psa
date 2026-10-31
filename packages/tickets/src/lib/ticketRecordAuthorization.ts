import { isMspPrincipalUserType } from '@alga-psa/types';
import type { Knex } from 'knex';
import type { ITicket, IUserWithRoles } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationRecord,
  type AuthorizationSubject,
} from '@alga-psa/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';
import { extractActiveWatcherContactIds } from '@alga-psa/authorization/portal/visibility';
import type { AuthorizationKernel } from '@alga-psa/authorization/kernel';
import { TicketWatcherError } from '@alga-psa/shared/services/tickets/ticketWatcherService';
import { getClientContactVisibilityContext } from './clientPortalVisibility.server';

/**
 * Per-record ticket authorization for server actions.
 *
 * Server actions cannot rely on `hasPermission('ticket', 'read'|'update')`
 * alone: that is coarse RBAC and does not apply the bundle/relationship
 * narrowing an internal principal can be subject to. This mirrors the kernel
 * evaluation in `ticketActions.ts:getTicketById`/`getTicketsForList` so every
 * ticket-scoped sub-resource (e.g. external links) resolves the owning ticket
 * and evaluates the same policy before reading or mutating it.
 *
 * Server-only: imports the authorization kernel and client-portal visibility.
 */

type Conn = Knex | Knex.Transaction;

function tenantScopedTable(conn: Conn, tenant: string, table: string): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table) as Knex.QueryBuilder;
}

function extractRoleIdsFromUser(user: unknown): string[] {
  const roles = (user as { roles?: unknown }).roles;
  if (!Array.isArray(roles)) {
    return [];
  }

  return roles
    .map((role) => {
      if (typeof role === 'string') {
        return role;
      }
      if (role && typeof role === 'object' && 'role_id' in role) {
        const roleId = (role as { role_id?: unknown }).role_id;
        return typeof roleId === 'string' ? roleId : null;
      }
      return null;
    })
    .filter((value): value is string => Boolean(value));
}

async function resolveAuthorizationSubjectForUser(
  trx: Conn,
  tenant: string,
  user: IUserWithRoles,
): Promise<AuthorizationSubject> {
  let roleIds = extractRoleIdsFromUser(user);
  if (roleIds.length === 0) {
    try {
      const roleRows = await tenantScopedTable(trx, tenant, 'user_roles')
        .where({ user_id: user.user_id })
        .select<{ role_id: string }[]>('role_id');
      roleIds = roleRows.map((row) => row.role_id);
    } catch {
      roleIds = [];
    }
  }

  let teamRows: Array<{ team_id: string }> = [];
  let managedRows: Array<{ user_id: string }> = [];
  try {
    teamRows = await tenantScopedTable(trx, tenant, 'team_members')
      .where({ user_id: user.user_id })
      .select<{ team_id: string }[]>('team_id');
  } catch {
    teamRows = [];
  }
  try {
    managedRows = await tenantScopedTable(trx, tenant, 'users')
      .where({ reports_to: user.user_id })
      .select<{ user_id: string }[]>('user_id');
  } catch {
    managedRows = [];
  }

  return {
    tenant,
    userId: user.user_id,
    userType: user.user_type,
    roleIds,
    teamIds: teamRows.map((row) => row.team_id),
    managedUserIds: managedRows.map((row) => row.user_id),
    clientId: user.clientId ?? null,
    portfolioClientIds: [],
  };
}

export function toTicketAuthorizationRecord(ticket: Partial<ITicket>): AuthorizationRecord {
  // Only the primary assignee grants ticket read authorization. Do not trust
  // `ticket_resources.additional_user_id` as an authorization assignment because
  // time-entry workflows can create those rows without ticket row-level access.
  const assignees = new Set<string>();
  if (ticket.assigned_to) assignees.add(ticket.assigned_to);
  return {
    id: ticket.ticket_id ?? null,
    ownerUserId: ticket.entered_by ?? null,
    assignedUserIds: Array.from(assignees),
    clientId: ticket.client_id ?? null,
    boardId: ticket.board_id ?? null,
    contactId: ticket.contact_name_id ?? null,
    // `undefined` (column not selected) can never satisfy a profile grant.
    billingProfileId: ticket.billing_profile_id,
    watcherContactIds: extractActiveWatcherContactIds(ticket.attributes),
    teamIds: ticket.assigned_team_id ? [ticket.assigned_team_id] : [],
  };
}

async function resolveClientSelectedBoardIds(
  trx: Conn,
  tenant: string,
  user: IUserWithRoles,
): Promise<string[] | undefined> {
  if (isMspPrincipalUserType(user.user_type)) {
    return undefined;
  }

  if (!user.contact_id) {
    return [];
  }

  try {
    const visibilityContext = await getClientContactVisibilityContext(
      trx as Knex.Transaction,
      tenant,
      user.contact_id,
    );
    return visibilityContext.visibleBoardIds ?? undefined;
  } catch {
    // Fail closed for client-portal users when visibility context cannot be
    // resolved safely.
    return [];
  }
}

interface TicketAuthorizationContext {
  authorizationSubject: AuthorizationSubject;
  selectedBoardIds: string[] | undefined;
  authorizationKernel: ReturnType<typeof createAuthorizationKernel>;
  requestCache: RequestLocalAuthorizationCache;
}

async function createTicketAuthorizationContext(
  trx: Conn,
  tenant: string,
  user: IUserWithRoles,
): Promise<TicketAuthorizationContext> {
  const authorizationSubject = await resolveAuthorizationSubjectForUser(trx, tenant, user);
  const selectedBoardIds = await resolveClientSelectedBoardIds(trx, tenant, user);
  const relationshipRules =
    selectedBoardIds === undefined ? [] : [{ template: 'selected_boards' as const }];
  const authorizationKernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider({
      relationshipRules,
    }),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (input) => {
        try {
          return await resolveBundleNarrowingRulesForEvaluation(trx as Knex.Transaction, input);
        } catch {
          return [];
        }
      },
    }),
    rbacEvaluator: async () => true,
  });
  const requestCache = new RequestLocalAuthorizationCache();

  return { authorizationSubject, selectedBoardIds, authorizationKernel, requestCache };
}

export interface TicketRecordRow {
  ticket_id: string;
  assigned_to: string | null;
  entered_by: string | null;
  client_id: string | null;
  board_id: string | null;
  assigned_team_id: string | null;
  contact_name_id: string | null;
  billing_profile_id: string | null;
  attributes: unknown;
}

async function resolveTicketRecord(
  trx: Conn,
  tenant: string,
  ticketId: string,
): Promise<TicketRecordRow | null> {
  const row = (await tenantScopedTable(trx, tenant, 'tickets')
    .where({ ticket_id: ticketId })
    .first(
      'ticket_id',
      'assigned_to',
      'entered_by',
      'client_id',
      'board_id',
      'assigned_team_id',
      'contact_name_id',
      'billing_profile_id',
      'attributes',
    )) as TicketRecordRow | undefined;
  return row ?? null;
}

/**
 * Resolve the owning ticket and evaluate the per-record authorization policy
 * for the given action. Throws `Ticket not found` when the ticket does not
 * exist in the tenant (mapped to 404 upstream) and a `Permission denied` error
 * when the principal is not allowed to access this specific ticket (mapped to
 * 403). Returns the resolved row so callers can reuse it.
 */
export async function authorizeTicketRecordAccess(input: {
  trx: Conn;
  tenant: string;
  user: IUserWithRoles;
  ticketId: string;
  action: 'read' | 'update';
}): Promise<TicketRecordRow> {
  const ticket = await resolveTicketRecord(input.trx, input.tenant, input.ticketId);
  if (!ticket) {
    throw new Error('Ticket not found');
  }

  const context = await createTicketAuthorizationContext(input.trx, input.tenant, input.user);
  const decision = await context.authorizationKernel.authorizeResource({
    subject: context.authorizationSubject,
    resource: {
      type: 'ticket',
      action: input.action,
      id: input.ticketId,
    },
    record: toTicketAuthorizationRecord(ticket as Partial<ITicket>),
    selectedBoardIds: context.selectedBoardIds,
    requestCache: context.requestCache,
    knex: input.trx as Knex,
  });

  if (!decision.allowed) {
    throw new Error('Permission denied: Cannot access ticket');
  }

  return ticket;
}

// LEVERAGE: pattern ticket-read-authorization — the ticketActions.ts / optimizedTicketActions.ts copies of this kernel construction should converge on this module

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The actor passed the coarse permission but not the per-record update decision. */
export class TicketWatcherPermissionError extends Error {
  constructor() {
    super('Permission denied: Cannot update ticket watchers');
    this.name = 'TicketWatcherPermissionError';
  }
}

/**
 * Who is writing. Server actions pass the session user (subject + kernel are
 * resolved here); the REST path passes the subject it already built with
 * `buildAuthorizationPrincipalSubject` (API keys) and its own (possibly
 * enterprise) kernel.
 */
export type TicketWatcherWritePrincipal =
  | { user: IUserWithRoles }
  | { subject: AuthorizationSubject; kernel: AuthorizationKernel };

/**
 * The one authorized watcher command shared by the server actions and the REST
 * service. Inside the caller's transaction, BEFORE `write` touches any watcher
 * row, it loads the ticket (tenant-scoped, row-locked), builds the ticket
 * authorization record and requires the kernel to allow `ticket:update` on that
 * record (plus any mutation guards). Missing, other-tenant and malformed ids all
 * surface as TicketWatcherError('ticket_not_found'); a record-scope denial throws
 * TicketWatcherPermissionError.
 */
export async function runAuthorizedTicketWatcherWrite<T>(input: {
  trx: Knex.Transaction;
  tenant: string;
  ticketId: string;
  principal: TicketWatcherWritePrincipal;
  write: (trx: Knex.Transaction) => Promise<T>;
}): Promise<T> {
  const { trx, tenant, ticketId, principal } = input;
  const ticket = UUID_PATTERN.test(ticketId)
    ? ((await tenantScopedTable(trx, tenant, 'tickets')
        .where({ ticket_id: ticketId })
        .forUpdate()
        .first()) as (Partial<ITicket> & { ticket_id: string }) | undefined)
    : undefined;
  if (!ticket) {
    throw new TicketWatcherError('ticket_not_found');
  }

  let subject: AuthorizationSubject;
  let kernel: AuthorizationKernel;
  let selectedBoardIds: string[] | undefined;
  if ('user' in principal) {
    const context = await createTicketAuthorizationContext(trx, tenant, principal.user);
    subject = context.authorizationSubject;
    kernel = context.authorizationKernel;
    selectedBoardIds = context.selectedBoardIds;
  } else {
    subject = { ...principal.subject, tenant };
    kernel = principal.kernel;
  }

  const record = toTicketAuthorizationRecord(ticket);
  const decision = await kernel.authorizeMutation({
    subject,
    resource: { type: 'ticket', action: 'update', id: ticketId },
    record,
    mutation: { kind: 'update_watchers', record },
    selectedBoardIds,
    requestCache: new RequestLocalAuthorizationCache(),
    knex: trx,
  });
  if (!decision.allowed) {
    throw new TicketWatcherPermissionError();
  }

  return input.write(trx);
}
