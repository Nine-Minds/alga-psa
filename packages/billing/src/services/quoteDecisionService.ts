/**
 * Quote decision service: the one place a sent quote is accepted or rejected.
 *
 * The caller names an explicit actor (portal user, validated email-link holder, MSP
 * user) and the service owns, in one transaction: authorisation for that actor kind,
 * optional-item selection persistence, the state transition, the `quote_decisions`
 * audit row, the QuoteActivity entry and the `onQuoteAccepted` hook.
 *
 * The quote row is locked (`FOR UPDATE`) before anything is read, so concurrent
 * deciders serialise: the first one transitions `sent -> accepted|rejected`, every
 * later one re-reads a decided quote and gets `not_pending` (or `already_decided` if
 * the guarded transition finds it moved) with nothing written - which is what makes
 * `onQuoteAccepted` and the QUOTE_ACCEPTED/QUOTE_REJECTED lifecycle event fire exactly
 * once per decision.
 */
import type { Knex } from 'knex';
import type { IQuote, IQuoteItem, IUserWithRoles } from '@alga-psa/types';
import type { QuoteActor, QuoteLifecycleOptions } from '@alga-psa/shared/lib/quotes/quoteLifecycleEvents';
import { getConnection, tenantDb, withTransaction } from '@alga-psa/db';
import { onQuoteAccepted } from '@alga-psa/opportunities/lib/quoteLifecycleHooks';
import Quote from '../models/quote';
import QuoteActivity from '../models/quoteActivity';
import { recalculateQuoteFinancials } from './quoteCalculationService';
import { getClientIdFromPortalUser, hasClientBillingReadPermission } from '../lib/clientPortalAccess';

export type QuoteDecisionAction = 'accept' | 'reject';
export type QuoteDecisionMethod = 'portal' | 'email_link' | 'msp_marked';

export type QuoteDecisionActor =
  | { kind: 'portal_user'; userId: string }
  /** The caller has already validated the link; the service does not re-check the token. */
  | { kind: 'access_link'; linkId: string; contactId?: string | null; email: string }
  /** The caller has already done the MSP permission checks. */
  | { kind: 'msp_user'; userId: string | null };

export interface QuoteDecisionSigner {
  name?: string | null;
  email?: string | null;
  title?: string | null;
}

export interface QuoteDecisionContext {
  ip?: string | null;
  userAgent?: string | null;
  agreementTextHash?: string | null;
}

export interface QuoteDecisionSelections {
  /** Optional line items the client chose to keep. Every other optional item is deselected. */
  selectedOptionalQuoteItemIds: string[];
}

export interface DecideQuoteInput {
  tenantId: string;
  quoteId: string;
  action: QuoteDecisionAction;
  actor: QuoteDecisionActor;
  selections?: QuoteDecisionSelections;
  /** Rejection reason for `reject`; free-form note for an MSP-marked `accept`. */
  comment?: string | null;
  signer?: QuoteDecisionSigner;
  context?: QuoteDecisionContext;
}

export type QuoteDecisionResult =
  | { status: 'decided'; quote: IQuote; decisionId: string }
  /** The guarded transition found the quote no longer `sent`. Nothing was written. */
  | { status: 'already_decided' }
  /** The quote is not in `sent` (including a concurrent decider that lost the row lock). Nothing was written. */
  | { status: 'not_pending'; currentStatus: string | null }
  /** Missing, other tenant/client, draft, or a template. */
  | { status: 'not_found' }
  | { status: 'forbidden'; reason: QuoteDecisionForbiddenReason };

export type QuoteDecisionForbiddenReason = 'no_client' | 'no_billing_permission' | 'unsupported_action';

export type PortalQuoteAccessResult =
  | { ok: true; quote: IQuote }
  | { ok: false; reason: 'no_client' | 'no_billing_permission' | 'not_found' | 'invalid_state' };

/**
 * The client-portal quote access rule: the user belongs to a client, can read billing,
 * and the quote is that client's non-draft, non-template quote (optionally in one of
 * `allowedStatuses`). Shared by the portal read paths and by `decideQuote`.
 */
export async function authorizePortalUserForQuote(
  trx: Knex | Knex.Transaction,
  user: Pick<IUserWithRoles, 'user_id' | 'contact_id'>,
  tenant: string,
  quoteId: string,
  allowedStatuses?: string[],
): Promise<PortalQuoteAccessResult> {
  const clientId = await getClientIdFromPortalUser(trx, user, tenant);
  if (!clientId) {
    return { ok: false, reason: 'no_client' };
  }

  const hasAccess = await hasClientBillingReadPermission(trx, user, tenant);
  if (!hasAccess) {
    return { ok: false, reason: 'no_billing_permission' };
  }

  const quote = await Quote.getById(trx, tenant, quoteId);
  if (!quote || quote.client_id !== clientId || quote.is_template || quote.status === 'draft') {
    return { ok: false, reason: 'not_found' };
  }

  if (allowedStatuses?.length && (!quote.status || !allowedStatuses.includes(quote.status))) {
    return { ok: false, reason: 'invalid_state' };
  }

  return { ok: true, quote };
}

async function persistOptionalQuoteSelections(
  trx: Knex.Transaction,
  tenant: string,
  quoteId: string,
  quoteItems: IQuoteItem[],
  selectedOptionalQuoteItemIds: string[],
): Promise<{ selectedIds: string[]; deselectedIds: string[] }> {
  const optionalItems = quoteItems.filter((item) => item.is_optional);
  const optionalItemIds = new Set(optionalItems.map((item) => item.quote_item_id));
  const selectedIds = selectedOptionalQuoteItemIds.filter((itemId) => optionalItemIds.has(itemId));
  const selectedSet = new Set(selectedIds);

  for (const item of optionalItems) {
    await tenantDb(trx, tenant).table('quote_items')
      .where({ quote_item_id: item.quote_item_id })
      .update({
        is_selected: selectedSet.has(item.quote_item_id),
        updated_at: trx.fn.now(),
      });
  }

  await recalculateQuoteFinancials(trx, tenant, quoteId);

  return {
    selectedIds,
    deselectedIds: optionalItems
      .map((item) => item.quote_item_id)
      .filter((itemId) => !selectedSet.has(itemId)),
  };
}

type Authorized =
  | { ok: true; quote: IQuote; lifecycleActor: QuoteActor }
  | { ok: false; result: QuoteDecisionResult };

async function authorizeActor(
  trx: Knex.Transaction,
  input: DecideQuoteInput,
): Promise<Authorized> {
  const { tenantId, quoteId, actor } = input;

  if (actor.kind === 'portal_user') {
    const userRow = await tenantDb(trx, tenantId).table('users')
      .where({ user_id: actor.userId })
      .select('user_id', 'contact_id')
      .first<{ user_id: string; contact_id: string | null } | undefined>();
    const access = await authorizePortalUserForQuote(
      trx,
      { user_id: actor.userId, contact_id: userRow?.contact_id ?? undefined },
      tenantId,
      quoteId,
      ['sent'],
    );
    if ('reason' in access) {
      switch (access.reason) {
        case 'no_client':
        case 'no_billing_permission':
          return { ok: false, result: { status: 'forbidden', reason: access.reason } };
        case 'invalid_state': {
          const current = await Quote.getById(trx, tenantId, quoteId);
          return { ok: false, result: { status: 'not_pending', currentStatus: current?.status ?? null } };
        }
        default:
          return { ok: false, result: { status: 'not_found' } };
      }
    }
    return {
      ok: true,
      quote: access.quote,
      // The portal user acts as their contact (same as the pre-service portal actions).
      lifecycleActor: userRow?.contact_id
        ? { actorType: 'CONTACT', actorContactId: userRow.contact_id }
        : { actorType: 'USER', actorUserId: actor.userId },
    };
  }

  // access_link / msp_user: the caller has authorised the actor; the service still
  // enforces the facts about the quote itself.
  const quote = await Quote.getById(trx, tenantId, quoteId);
  if (!quote || quote.is_template) {
    return { ok: false, result: { status: 'not_found' } };
  }

  if (actor.kind === 'access_link' && actor.contactId) {
    const contact = await tenantDb(trx, tenantId).table('contacts')
      .where({ contact_name_id: actor.contactId })
      .select('client_id')
      .first<{ client_id: string | null } | undefined>();
    if (!contact || !quote.client_id || contact.client_id !== quote.client_id) {
      return { ok: false, result: { status: 'not_found' } };
    }
  }

  if (actor.kind === 'access_link' && quote.status === 'draft') {
    return { ok: false, result: { status: 'not_found' } };
  }

  if (quote.status !== 'sent') {
    return { ok: false, result: { status: 'not_pending', currentStatus: quote.status ?? null } };
  }

  return { ok: true, quote, lifecycleActor: lifecycleActorFor(actor) };
}

function lifecycleActorFor(actor: Exclude<QuoteDecisionActor, { kind: 'portal_user' }>): QuoteActor {
  if (actor.kind === 'access_link') {
    // A link without a contact (a recipient address only) has no actor id to carry.
    return actor.contactId
      ? { actorType: 'CONTACT', actorContactId: actor.contactId }
      : { actorType: 'SYSTEM' };
  }
  return actor.userId ? { actorType: 'USER', actorUserId: actor.userId } : { actorType: 'SYSTEM' };
}

function methodFor(actor: QuoteDecisionActor): QuoteDecisionMethod {
  switch (actor.kind) {
    case 'portal_user':
      return 'portal';
    case 'access_link':
      return 'email_link';
    case 'msp_user':
      return 'msp_marked';
  }
}

function actingUserId(actor: QuoteDecisionActor): string | null {
  return actor.kind === 'access_link' ? null : actor.userId;
}

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildAcceptedActivity(
  actor: QuoteDecisionActor,
  note: string | null,
  acceptedAt: string,
  selection: { selectedIds: string[]; deselectedIds: string[] } | null,
  actorUserId: string | null,
) {
  const selectionMetadata = selection
    ? {
        selected_optional_quote_item_ids: selection.selectedIds,
        deselected_optional_quote_item_ids: selection.deselectedIds,
      }
    : {};

  switch (actor.kind) {
    case 'portal_user':
      return {
        description: 'Quote accepted by client for MSP review',
        metadata: selectionMetadata,
      };
    case 'msp_user':
      return {
        description: note
          ? `Quote marked as accepted by MSP on behalf of the client: ${note}`
          : 'Quote marked as accepted by MSP on behalf of the client',
        metadata: {
          accepted_via: 'msp',
          accepted_by: actorUserId,
          accepted_at: acceptedAt,
          note,
        },
      };
    case 'access_link':
      return {
        description: 'Quote accepted by client via email link for MSP review',
        metadata: {
          ...selectionMetadata,
          accepted_via: 'email_link',
          link_id: actor.linkId,
          contact_id: actor.contactId ?? null,
          email: actor.email,
        },
      };
  }
}

function buildRejectedActivity(actor: QuoteDecisionActor, reason: string | null) {
  if (actor.kind === 'access_link') {
    return {
      description: 'Quote rejected by client via email link',
      metadata: {
        rejection_reason: reason,
        rejected_via: 'email_link',
        link_id: actor.linkId,
        contact_id: actor.contactId ?? null,
        email: actor.email,
      },
    };
  }
  return {
    description: 'Quote rejected by client',
    metadata: { rejection_reason: reason },
  };
}

async function decideInTransaction(
  trx: Knex.Transaction,
  input: DecideQuoteInput,
): Promise<QuoteDecisionResult> {
  const { tenantId, quoteId, action, actor } = input;

  if (action === 'reject' && actor.kind === 'msp_user') {
    return { status: 'forbidden', reason: 'unsupported_action' };
  }

  // Serialise every decider on the quote row before reading its state.
  await tenantDb(trx, tenantId).table('quotes')
    .where({ quote_id: quoteId })
    .forUpdate()
    .first('quote_id');

  const authorized = await authorizeActor(trx, input);
  if ('result' in authorized) {
    return authorized.result;
  }

  const userId = actingUserId(actor);
  const comment = trimmedOrNull(input.comment);
  const decidedAt = new Date().toISOString();

  // 1. Selections, under the row lock and before the transition: the QUOTE_ACCEPTED
  // event recorded by the transition reports the selected optional items.
  const selection = action === 'accept' && input.selections
    ? await persistOptionalQuoteSelections(
        trx,
        tenantId,
        quoteId,
        authorized.quote.quote_items || [],
        input.selections.selectedOptionalQuoteItemIds,
      )
    : null;

  // 2. The transition (with its lifecycle event). Null means the quote left `sent`:
  // throw so the selection writes above roll back with it.
  const lifecycle: QuoteLifecycleOptions = {
    actor: authorized.lifecycleActor,
    acceptedOnBehalf: actor.kind === 'msp_user',
  };
  const transitioned = action === 'accept'
    ? await Quote.updateIfStatus(trx, tenantId, quoteId, 'sent', {
        status: 'accepted',
        accepted_at: decidedAt,
        accepted_by: userId,
        updated_by: userId,
      }, lifecycle)
    : await Quote.updateIfStatus(trx, tenantId, quoteId, 'sent', {
        status: 'rejected',
        rejected_at: decidedAt,
        rejection_reason: comment,
        updated_by: userId,
      }, lifecycle);
  if (!transitioned) {
    if (selection) {
      throw new QuoteAlreadyDecidedError();
    }
    return { status: 'already_decided' };
  }

  // 3. Audit row.
  const [decision] = await tenantDb(trx, tenantId).table('quote_decisions')
    .insert({
      tenant: tenantId,
      quote_id: quoteId,
      decision: action === 'accept' ? 'accepted' : 'rejected',
      method: methodFor(actor),
      actor_user_id: userId,
      contact_id: actor.kind === 'access_link' ? actor.contactId ?? null : null,
      link_id: actor.kind === 'access_link' ? actor.linkId : null,
      signer_name: trimmedOrNull(input.signer?.name),
      signer_email: trimmedOrNull(input.signer?.email),
      signer_title: trimmedOrNull(input.signer?.title),
      comment,
      selections: JSON.stringify(selection
        ? {
            selected_optional_quote_item_ids: selection.selectedIds,
            deselected_optional_quote_item_ids: selection.deselectedIds,
          }
        : {}),
      agreement_text_hash: input.context?.agreementTextHash ?? null,
      ip: input.context?.ip ?? null,
      user_agent: input.context?.userAgent ?? null,
      decided_at: decidedAt,
    })
    .returning('decision_id') as Array<{ decision_id: string }>;

  // 4. Activity.
  const activity = action === 'accept'
    ? buildAcceptedActivity(actor, comment, decidedAt, selection, userId)
    : buildRejectedActivity(actor, comment);
  await QuoteActivity.create(trx, tenantId, {
    quote_id: quoteId,
    activity_type: action === 'accept' ? 'accepted' : 'rejected',
    description: activity.description,
    performed_by: userId,
    metadata: activity.metadata,
  });

  // 5. Hook, last, on the committed-in-this-transaction state.
  const decidedQuote = await Quote.getById(trx, tenantId, quoteId);
  if (!decidedQuote) {
    throw new Error(action === 'accept' ? 'Quote not found after acceptance' : 'Quote not found after rejection');
  }
  if (action === 'accept') {
    await onQuoteAccepted(trx, decidedQuote);
  }

  return { status: 'decided', quote: decidedQuote, decisionId: decision.decision_id };
}

/**
 * Accept or reject a quote on behalf of `actor`.
 *
 * Pass `trx` to join the caller's transaction (the portal actions and
 * `markQuoteAccepted` do); omit it and the service opens its own for `tenantId`.
 */
export async function decideQuote(
  input: DecideQuoteInput,
  trx?: Knex.Transaction,
): Promise<QuoteDecisionResult> {
  if (trx) {
    return decideInTransaction(trx, input);
  }
  const knex = await getConnection(input.tenantId);
  try {
    return await withTransaction(knex, (ownTrx: Knex.Transaction) => decideInTransaction(ownTrx, input));
  } catch (error) {
    if (error instanceof QuoteAlreadyDecidedError) {
      return { status: 'already_decided' };
    }
    throw error;
  }
}

/**
 * The guarded transition found the quote already decided after selections were written.
 * Unreachable while the row lock is held; thrown (not returned) so those writes roll back.
 */
export class QuoteAlreadyDecidedError extends Error {
  constructor() {
    super('Quote is not in a valid state for this action');
    this.name = 'QuoteAlreadyDecidedError';
  }
}
