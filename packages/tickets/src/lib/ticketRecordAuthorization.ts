import { isClientUserType, isMspPrincipalUserType } from '@alga-psa/types';
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
  type RelationshipRule,
} from '@alga-psa/authorization/kernel';
import { compileTenantScopedResourceReadAuthorizationSql } from '@alga-psa/authorization/kernel';
import type { TenantScopedQuery } from '@alga-psa/db';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';
import { extractActiveWatcherContactIds } from '@alga-psa/authorization/portal/visibility';
import type { ContactVisibilityContext } from './clientPortalVisibility';
import { getClientContactVisibilityContext } from './clientPortalVisibility.server';
import { createTicketRelationshipSqlAdapter } from './ticketAuthorizationSql';

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
    } catch (error) {
      throw new Error('Unable to resolve ticket authorization roles', { cause: error });
    }
  }

  let teamRows: Array<{ team_id: string }> = [];
  let managedRows: Array<{ user_id: string }> = [];
  try {
    teamRows = await tenantScopedTable(trx, tenant, 'team_members')
      .where({ user_id: user.user_id })
      .select<{ team_id: string }[]>('team_id');
  } catch (error) {
    throw new Error('Unable to resolve ticket authorization teams', { cause: error });
  }
  try {
    managedRows = await tenantScopedTable(trx, tenant, 'users')
      .where({ reports_to: user.user_id })
      .select<{ user_id: string }[]>('user_id');
  } catch (error) {
    throw new Error('Unable to resolve ticket authorization reporting relationships', { cause: error });
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

function toTicketAuthorizationRecord(ticket: Partial<ITicket>): AuthorizationRecord {
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

async function resolveClientVisibility(
  trx: Conn,
  tenant: string,
  user: IUserWithRoles,
): Promise<ContactVisibilityContext | null | undefined> {
  // `undefined` = internal principal (no portal narrowing).
  if (isMspPrincipalUserType(user.user_type)) return undefined;
  // `null` = client principal whose visibility cannot be established: deny all.
  if (!user.contact_id) return null;
  try {
    return await getClientContactVisibilityContext(trx as Knex.Transaction, tenant, user.contact_id);
  } catch {
    return null;
  }
}

export interface TicketAuthorizationContext {
  authorizationSubject: AuthorizationSubject;
  selectedBoardIds: string[] | undefined;
  contactVisibility: ContactVisibilityContext | null | undefined;
  authorizationKernel: ReturnType<typeof createAuthorizationKernel>;
  requestCache: RequestLocalAuthorizationCache;
  ticketReadBundleNarrowingRules: Awaited<ReturnType<typeof resolveBundleNarrowingRulesForEvaluation>>;
}

export async function createTicketAuthorizationContext(
  trx: Conn,
  tenant: string,
  user: IUserWithRoles,
): Promise<TicketAuthorizationContext> {
  const authorizationSubject = await resolveAuthorizationSubjectForUser(trx, tenant, user);
  const contactVisibility = await resolveClientVisibility(trx, tenant, user);
  const selectedBoardIds =
    contactVisibility === null ? [] : contactVisibility?.visibleBoardIds ?? undefined;
  // Built-in rules combine with OR, so `same_client` must NOT be listed next to
  // `contact_visibility`: it would admit every same-client ticket and defeat the
  // board/contact/billing-profile narrowing. `contact_visibility` already requires the
  // ticket to belong to the contact's client and denies when the context is null.
  const relationshipRules: RelationshipRule[] =
    contactVisibility === undefined ? [] : [{ template: 'contact_visibility' }];
  const requestCache = new RequestLocalAuthorizationCache();
  const ticketReadBundleNarrowingRules = await resolveBundleNarrowingRulesForEvaluation(trx as Knex.Transaction, {
    subject: authorizationSubject,
    resource: { type: 'ticket', action: 'read' },
    selectedBoardIds,
    contactVisibility,
    requestCache,
    knex: trx as Knex,
  });
  const authorizationKernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider({
      relationshipRules,
    }),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (input) => input.resource.type === 'ticket' && input.resource.action === 'read'
        ? ticketReadBundleNarrowingRules
        : resolveBundleNarrowingRulesForEvaluation(trx as Knex.Transaction, input),
    }),
    rbacEvaluator: async () => true,
  });
  return {
    authorizationSubject,
    selectedBoardIds,
    contactVisibility,
    authorizationKernel,
    requestCache,
    ticketReadBundleNarrowingRules,
  };
}

/** Shared compiler boundary for ticket lists and search's correlated ticket queries. */
export function applyTicketReadAuthorizationSql(
  query: TenantScopedQuery,
  trx: Conn,
  tenant: string,
  context: TicketAuthorizationContext,
): { supported: true } | { supported: false; reason: string } {
  return compileTenantScopedResourceReadAuthorizationSql(query, {
    resourceType: 'ticket',
    action: 'read',
    builtinRules: context.contactVisibility === undefined ? [] : [{ template: 'contact_visibility' }],
    bundleRules: context.ticketReadBundleNarrowingRules,
    ctx: {
      subject: context.authorizationSubject,
      selectedBoardIds: context.selectedBoardIds,
      contactVisibility: context.contactVisibility,
      adapter: createTicketRelationshipSqlAdapter(trx, tenant),
    },
  });
}

export interface TicketRecordRow {
  ticket_id: string;
  assigned_to: string | null;
  entered_by: string | null;
  client_id: string | null;
  board_id: string | null;
  assigned_team_id: string | null;
  contact_name_id?: string | null;
  billing_profile_id?: string | null;
  attributes?: Record<string, unknown> | null;
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

/** Evaluate a candidate batch with one request context and one ticket lookup. */
export async function authorizeTicketRecordBatch(input: {
  trx: Conn;
  tenant: string;
  user: IUserWithRoles;
  ticketIds: string[];
  action?: 'read' | 'update';
  context?: TicketAuthorizationContext;
}): Promise<Set<string>> {
  const ticketIds = [...new Set(input.ticketIds.filter(Boolean))];
  if (ticketIds.length === 0) return new Set();

  const loadedTickets = await tenantScopedTable(input.trx, input.tenant, 'tickets')
    .whereIn('ticket_id', ticketIds)
    .select<TicketRecordRow[]>(
      'ticket_id', 'assigned_to', 'entered_by', 'client_id', 'board_id', 'assigned_team_id',
      'contact_name_id', 'billing_profile_id', 'attributes',
    );
  const tickets = Array.isArray(loadedTickets) ? loadedTickets : loadedTickets ? [loadedTickets] : [];
  const ticketById = new Map(tickets.map((ticket) => [ticket.ticket_id, ticket]));
  const context = input.context ?? await createTicketAuthorizationContext(input.trx, input.tenant, input.user);
  const decisions = await Promise.all(ticketIds.map(async (ticketId) => {
    const ticket = ticketById.get(ticketId);
    if (!ticket) return [ticketId, false] as const;
    const decision = await context.authorizationKernel.authorizeResource({
      subject: context.authorizationSubject,
      resource: { type: 'ticket', action: input.action ?? 'read', id: ticketId },
      record: toTicketAuthorizationRecord(ticket as Partial<ITicket>),
      selectedBoardIds: context.selectedBoardIds,
      contactVisibility: context.contactVisibility,
      requestCache: context.requestCache,
      knex: input.trx as Knex,
    });
    return [ticketId, decision.allowed] as const;
  }));
  return new Set(decisions.filter(([, allowed]) => allowed).map(([ticketId]) => ticketId));
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
  /** Already-loaded ticket row (must include the authorization columns); skips the reload. */
  ticketRow?: TicketRecordRow;
}): Promise<TicketRecordRow> {
  const ticket =
    input.ticketRow ?? (await resolveTicketRecord(input.trx, input.tenant, input.ticketId));
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
    contactVisibility: context.contactVisibility,
    requestCache: context.requestCache,
    knex: input.trx as Knex,
  });

  if (!decision.allowed) {
    throw new Error('Permission denied: Cannot access ticket');
  }

  return ticket;
}

/**
 * Same policy as {@link authorizeTicketRecordAccess}, but a client principal gets the
 * identical `Permission denied` error whether the ticket is missing or not visible, so
 * a ticket UUID cannot be probed. Internal users keep `Ticket not found` (mapped to 404).
 * Kept separate so existing callers of authorizeTicketRecordAccess are unaffected.
 */
export async function authorizeTicketRecordAccessConcealed(
  input: Parameters<typeof authorizeTicketRecordAccess>[0],
): Promise<TicketRecordRow> {
  try {
    return await authorizeTicketRecordAccess(input);
  } catch (error) {
    if (isClientUserType(input.user.user_type) && error instanceof Error && error.message === 'Ticket not found') {
      throw new Error('Permission denied: Cannot access ticket');
    }
    throw error;
  }
}
