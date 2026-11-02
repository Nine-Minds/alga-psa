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
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';
import { extractActiveWatcherContactIds } from '@alga-psa/authorization/portal/visibility';
import type { AuthorizationKernel } from '@alga-psa/authorization/kernel';
import { TicketWatcherError } from '@alga-psa/shared/services/tickets/ticketWatcherService';
import type { ContactVisibilityContext } from './clientPortalVisibility';
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

interface TicketAuthorizationContext {
  authorizationSubject: AuthorizationSubject;
  selectedBoardIds: string[] | undefined;
  contactVisibility: ContactVisibilityContext | null | undefined;
  authorizationKernel: ReturnType<typeof createAuthorizationKernel>;
  requestCache: RequestLocalAuthorizationCache;
}

// LEVERAGE: pattern ticket-authorization-context — near-duplicate of createTicketAuthorizationContext in actions/optimizedTicketActions.ts (and ticketActions.ts); a shared builder would remove the drift that dropped contact visibility here.
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

  return {
    authorizationSubject,
    selectedBoardIds,
    contactVisibility,
    authorizationKernel,
    requestCache,
  };
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

/**
 * Same policy as {@link authorizeTicketRecordAccess}, but conceals whether a ticket exists so a
 * ticket UUID cannot be probed.
 *
 * - `conceal: 'client'` (default): a client principal gets the identical `Permission denied`
 *   error whether the ticket is missing or not visible (not-found -> denied). Internal users keep
 *   the distinct `Ticket not found` / `Permission denied` errors.
 * - `conceal: 'all'`: additionally, for non-client (internal) users a kernel denial is reported as
 *   `Ticket not found` (denied -> not-found), so a missing ticket and a policy-hidden ticket are
 *   indistinguishable (both map to 404). Only the exact kernel-denial message is remapped; every
 *   other error passes through unchanged. Client principals behave as in `'client'`.
 *
 * Kept separate so existing callers of authorizeTicketRecordAccess are unaffected.
 */
export async function authorizeTicketRecordAccessConcealed(
  input: Parameters<typeof authorizeTicketRecordAccess>[0] & { conceal?: 'client' | 'all' },
): Promise<TicketRecordRow> {
  const { conceal = 'client', ...accessInput } = input;
  try {
    return await authorizeTicketRecordAccess(accessInput);
  } catch (error) {
    if (error instanceof Error) {
      if (isClientUserType(input.user.user_type)) {
        if (error.message === 'Ticket not found') {
          throw new Error('Permission denied: Cannot access ticket');
        }
      } else if (conceal === 'all' && error.message === 'Permission denied: Cannot access ticket') {
        throw new Error('Ticket not found');
      }
    }
    throw error;
  }
}
