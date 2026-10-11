import type { Knex } from 'knex';
import { registerAfterCommit, tenantDb } from '@alga-psa/db';
import type { TicketResponseState } from '@alga-psa/types';

/**
 * Shared "comment added" response-state engine.
 *
 * Every surface that adds a ticket comment (MSP UI action, REST API, ...) must
 * resolve the author type the same way, move `tickets.response_state` by the
 * same rules, and announce the change exactly once. Those rules live here, in
 * `shared`, because both `packages/tickets` and `server` already depend on it
 * (neither can import the other without a cycle).
 *
 * Rules (server/migrations/20260104120000_add_response_state_to_tickets.cjs):
 *  - internal note                         -> no change
 *  - client-visible comment from staff     -> awaiting_client
 *  - comment from a client / contact       -> awaiting_internal
 *  - closing the ticket                    -> cleared (see publishResponseStateChange)
 *
 * The state write happens in the caller's transaction. The
 * TICKET_RESPONSE_STATE_CHANGED event is the single source for the outbound
 * `ticket.response_state_changed` webhook and is published after commit.
 * There is no database trigger that emits it.
 */

export type CommentAuthorType = 'internal' | 'client' | 'unknown';
export type ResponseStateTrigger = 'comment' | 'manual' | 'close';

/**
 * Whether response-state tracking is enabled for a tenant. Reads
 * tenant_settings.ticket_display_settings with fallback to the nested
 * settings.ticketing.display path. Defaults to enabled.
 */
export async function isResponseStateTrackingEnabled(tenant: string, knex: Knex): Promise<boolean> {
  const row = await tenantDb(knex, tenant)
    .table('tenant_settings')
    .select('ticket_display_settings', 'settings')
    .first();

  const fromColumn = (row?.ticket_display_settings as any) || {};
  const nested = ((row?.settings as any)?.ticketing?.display) || {};
  const display = Object.keys(fromColumn).length ? fromColumn : nested;

  return display.responseStateTrackingEnabled ?? true;
}

/**
 * Derive the comment author type (and linked contact) from the authenticated
 * user. An internal user is `internal`; any other existing user is `client`
 * and carries the contact linkage the UI path records on the comment row.
 */
export async function resolveCommentAuthor(
  trx: Knex | Knex.Transaction,
  tenant: string,
  userId: string | null | undefined
): Promise<{ authorType: CommentAuthorType; contactId: string | null }> {
  if (!userId) {
    return { authorType: 'unknown', contactId: null };
  }
  const user = await tenantDb(trx, tenant)
    .table('users')
    .select('user_type', 'contact_id')
    .where({ user_id: userId })
    .first();

  if (!user) {
    return { authorType: 'unknown', contactId: null };
  }
  if (user.user_type === 'internal') {
    return { authorType: 'internal', contactId: null };
  }
  return { authorType: 'client', contactId: user.contact_id ?? null };
}

/** Pure rule table: the state a comment moves the ticket to. */
export function nextResponseStateForComment(
  previousState: TicketResponseState,
  authorType: CommentAuthorType,
  isInternal: boolean
): TicketResponseState {
  if (isInternal) return previousState;
  if (authorType === 'internal') return 'awaiting_client';
  if (authorType === 'client') return 'awaiting_internal';
  return previousState;
}

/**
 * Announce a response-state change after the owning transaction commits.
 * The only publisher of TICKET_RESPONSE_STATE_CHANGED for comment and
 * API-driven transitions; callers must not publish it themselves.
 */
export function publishResponseStateChange(
  trx: Knex.Transaction,
  params: {
    tenant: string;
    ticketId: string;
    userId: string | null;
    previousState: TicketResponseState;
    newState: TicketResponseState;
    trigger: ResponseStateTrigger;
    occurredAt?: string;
  }
): void {
  if (params.previousState === params.newState) return;

  registerAfterCommit(
    trx,
    async () => {
      const { publishEvent } = await import('@alga-psa/event-bus/publishers');
      await publishEvent({
        eventType: 'TICKET_RESPONSE_STATE_CHANGED',
        payload: {
          tenantId: params.tenant,
          occurredAt: params.occurredAt ?? new Date().toISOString(),
          ticketId: params.ticketId,
          userId: params.userId,
          previousResponseState: params.previousState,
          newResponseState: params.newState,
          previousState: params.previousState,
          newState: params.newState,
          trigger: params.trigger,
        },
      });
    },
    `TICKET_RESPONSE_STATE_CHANGED ticket=${params.ticketId}`
  );
}

/**
 * Apply the comment rules to the ticket inside the caller's transaction and
 * queue the change event. Skips both when tracking is disabled for the tenant.
 */
export async function applyCommentResponseState(
  trx: Knex.Transaction,
  params: {
    tenant: string;
    ticketId: string;
    authorType: CommentAuthorType;
    isInternal: boolean;
    userId: string | null;
  }
): Promise<{ previousState: TicketResponseState; newState: TicketResponseState }> {
  const { tenant, ticketId } = params;

  if (!(await isResponseStateTrackingEnabled(tenant, trx))) {
    return { previousState: null, newState: null };
  }

  const ticket = await tenantDb(trx, tenant)
    .table('tickets')
    .select('response_state')
    .where({ ticket_id: ticketId })
    .first();

  const previousState = (ticket?.response_state || null) as TicketResponseState;
  const newState = nextResponseStateForComment(previousState, params.authorType, params.isInternal);

  if (newState !== previousState) {
    await tenantDb(trx, tenant)
      .table('tickets')
      .where({ ticket_id: ticketId })
      .update({ response_state: newState });

    publishResponseStateChange(trx, {
      tenant,
      ticketId,
      userId: params.userId,
      previousState,
      newState,
      trigger: 'comment',
    });
  }

  return { previousState, newState };
}
