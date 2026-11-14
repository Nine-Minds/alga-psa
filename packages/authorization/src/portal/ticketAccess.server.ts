import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isClientUserType } from '@alga-psa/types';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
} from '../kernel';
import { resolveBundleNarrowingRulesForEvaluation } from '../bundles/service';
import { resolveAuthorizationSubjectForUser } from '../assetReadAuthorization';
import { extractActiveWatcherContactIds, ticketMatchesVisibility } from './visibility';
import { getClientContactVisibilityContext } from './visibility.server';

type Conn = Knex | Knex.Transaction;
type TicketAction = 'read' | 'update';

/**
 * Record-scope ticket authorization for callers that only hold ids (attachments, documents).
 * This is the record layer only: callers enforce RBAC (`ticket:read` / `document:*`) themselves,
 * so the kernel's rbacEvaluator is permissive exactly as in ticketActions' authorizeTicketRead.
 * Fails closed: any error resolving the user, ticket, visibility or kernel decision denies.
 *
 * Client principals are decided by the portal visibility predicate (client/contact scope, board
 * restriction, manager/billing-profile/watcher grants). It has no read/write distinction: the
 * portal's own comment gate (`authorizeTicketRecordAccessConcealed(..., 'update')`) evaluates the
 * same `contact_visibility` template, so write == read for clients.
 * MSP principals go through the kernel (bundle narrowing) with the `read` / `update` action.
 */
// LEVERAGE: pattern ticket-read-authorization — kernel construction duplicated with ticketActions.ts authorizeTicketRead, optimizedTicketActions.ts and packages/tickets/src/lib/ticketRecordAuthorization.ts; this module is the dependency-free (shared-reachable) copy.
async function canAccessTicket(conn: Conn, tenant: string, userId: string, ticketId: string, action: TicketAction): Promise<boolean> {
  try {
    const db = tenantDb(conn, tenant);
    const [user, ticket] = await Promise.all([
      db.table('users').where({ user_id: userId, is_inactive: false }).first(),
      db.table('tickets').where({ ticket_id: ticketId }).first(
        'ticket_id', 'assigned_to', 'entered_by', 'client_id', 'board_id', 'assigned_team_id',
        'contact_name_id', 'billing_profile_id', 'attributes',
      ),
    ]);
    if (!user || !ticket) return false;

    if (isClientUserType(user.user_type)) {
      if (!user.contact_id) return false;
      const visibility = await getClientContactVisibilityContext(conn as Knex.Transaction, tenant, user.contact_id);
      return ticketMatchesVisibility({
        clientId: ticket.client_id,
        boardId: ticket.board_id,
        contactId: ticket.contact_name_id,
        billingProfileId: ticket.billing_profile_id,
        watcherContactIds: extractActiveWatcherContactIds(ticket.attributes),
      }, visibility);
    }
    if (user.user_type !== 'internal') return false;

    const subject = await resolveAuthorizationSubjectForUser(conn, tenant, { user_id: user.user_id, user_type: user.user_type });
    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider({ relationshipRules: [] }),
      bundleProvider: new BundleAuthorizationKernelProvider({
        resolveRules: input => resolveBundleNarrowingRulesForEvaluation(conn as Knex.Transaction, input),
      }),
      rbacEvaluator: async () => true,
    });
    const decision = await kernel.authorizeResource({
      subject,
      resource: { type: 'ticket', action, id: ticket.ticket_id },
      record: {
        id: ticket.ticket_id ?? null,
        ownerUserId: ticket.entered_by ?? null,
        // Only the primary assignee grants access; ticket_resources rows are not authorization.
        assignedUserIds: ticket.assigned_to ? [ticket.assigned_to] : [],
        clientId: ticket.client_id ?? null,
        boardId: ticket.board_id ?? null,
        contactId: ticket.contact_name_id ?? null,
        billingProfileId: ticket.billing_profile_id,
        watcherContactIds: extractActiveWatcherContactIds(ticket.attributes),
        teamIds: ticket.assigned_team_id ? [ticket.assigned_team_id] : [],
      },
      selectedBoardIds: undefined,
      contactVisibility: undefined,
      requestCache: new RequestLocalAuthorizationCache(),
      knex: conn as Knex,
    });
    return decision.allowed === true;
  } catch {
    return false;
  }
}

export const canReadTicket = (conn: Conn, tenant: string, userId: string, ticketId: string) =>
  canAccessTicket(conn, tenant, userId, ticketId, 'read');

export const canWriteTicket = (conn: Conn, tenant: string, userId: string, ticketId: string) =>
  canAccessTicket(conn, tenant, userId, ticketId, 'update');
