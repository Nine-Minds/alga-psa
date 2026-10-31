/**
 * Authoritative accept/reject for the public (email-link) quote page.
 *
 * The rendered page is never trusted: every submit re-resolves the token inside
 * the same transaction as the decision, validates the input server-side, and then
 * delegates to `decideQuote` with the `access_link` actor. Any problem with the
 * link itself (missing, expired, revoked, superseded, rate limited, quote no
 * longer `sent`) collapses into ONE generic `invalid_link` outcome so the caller
 * learns nothing about why a token does not work.
 *
 * Nothing here logs or returns the raw token.
 */
import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { getConnection, tenantDb, withTransaction } from '@alga-psa/db';
import {
  QUOTE_ACCEPTANCE_AGREEMENT_TEXT,
  QUOTE_ACCEPTANCE_AGREEMENT_VERSION,
} from '../lib/quoteAgreement';
import { decideQuote } from './quoteDecisionService';
import { QuoteAccessLinks, isWellFormedQuoteAccessToken } from './quoteAccessLinks';

export const QUOTE_LINK_DECISION_LIMITS = {
  name: 200,
  title: 200,
  comment: 4000,
  selections: 500,
} as const;

export interface QuoteAgreementDescriptor {
  version: string;
  text: string;
  hash: string;
}

export function hashQuoteAgreementText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The current agreement wording, version and server-computed hash. */
export function getCurrentQuoteAgreement(): QuoteAgreementDescriptor {
  return {
    version: QUOTE_ACCEPTANCE_AGREEMENT_VERSION,
    text: QUOTE_ACCEPTANCE_AGREEMENT_TEXT,
    hash: hashQuoteAgreementText(QUOTE_ACCEPTANCE_AGREEMENT_TEXT),
  };
}

export interface QuoteLinkDecisionInput {
  action: 'accept' | 'reject';
  signer?: { name?: string | null; title?: string | null };
  agreed?: boolean;
  agreementVersion?: string | null;
  agreementTextHash?: string | null;
  selectedOptionalQuoteItemIds?: string[];
  comment?: string | null;
}

export interface QuoteLinkRequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

export type QuoteLinkInputProblem =
  | 'name_required'
  | 'agreement_required'
  | 'agreement_outdated'
  | 'comment_required'
  | 'invalid_selection'
  | 'too_long'
  | 'invalid_action';

export type QuoteLinkDecisionOutcome =
  | { status: 'decided'; decision: 'accepted' | 'rejected'; decidedAt: string }
  | { status: 'already_decided'; decision: 'accepted' | 'rejected'; decidedAt: string }
  /** The MSP changed the quote after the page was rendered. */
  | { status: 'changed' }
  | { status: 'invalid_input'; problem: QuoteLinkInputProblem }
  /** Deliberately reason-free. */
  | { status: 'invalid_link' };

const INVALID_LINK: QuoteLinkDecisionOutcome = { status: 'invalid_link' };

type DecisionRow = { decision: 'accepted' | 'rejected'; decided_at: Date | string };

async function latestDecision(trx: Knex.Transaction, tenant: string, quoteId: string) {
  const row = await tenantDb(trx, tenant)
    .table('quote_decisions')
    .where({ quote_id: quoteId })
    .orderBy('decided_at', 'desc')
    .first<DecisionRow | undefined>('decision', 'decided_at');
  return row ?? null;
}

/**
 * The quote is no longer `sent`. If it was decided (by this link or another path) report
 * that decision's date; otherwise the MSP changed it. A caller holding a valid link may
 * be told this much: it reveals nothing about the token.
 */
async function settledOutcome(
  trx: Knex.Transaction,
  tenant: string,
  quoteId: string,
): Promise<QuoteLinkDecisionOutcome> {
  const current = await tenantDb(trx, tenant)
    .table('quotes')
    .where({ quote_id: quoteId })
    .first<{ status: string } | undefined>('status');
  const existing = await latestDecision(trx, tenant, quoteId);
  if (existing && (current?.status === 'accepted' || current?.status === 'rejected')) {
    return { status: 'already_decided', decision: existing.decision, decidedAt: iso(existing.decided_at) };
  }
  return { status: 'changed' };
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function validate(
  input: QuoteLinkDecisionInput,
  optionalItemIds: Set<string>,
): QuoteLinkInputProblem | null {
  const L = QUOTE_LINK_DECISION_LIMITS;
  if (input.action === 'reject') {
    const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
    if (!comment) return 'comment_required';
    if (comment.length > L.comment) return 'too_long';
    return null;
  }
  if (input.action !== 'accept') return 'invalid_action';

  const name = typeof input.signer?.name === 'string' ? input.signer.name.trim() : '';
  if (!name) return 'name_required';
  const title = typeof input.signer?.title === 'string' ? input.signer.title.trim() : '';
  if (name.length > L.name || title.length > L.title) return 'too_long';
  if (input.agreed !== true) return 'agreement_required';

  const current = getCurrentQuoteAgreement();
  if (input.agreementVersion !== current.version || input.agreementTextHash !== current.hash) {
    return 'agreement_outdated';
  }

  const selected = input.selectedOptionalQuoteItemIds ?? [];
  if (!Array.isArray(selected) || selected.length > L.selections) return 'invalid_selection';
  for (const id of selected) {
    if (typeof id !== 'string' || !optionalItemIds.has(id)) return 'invalid_selection';
  }
  return null;
}

async function submitInTransaction(
  trx: Knex.Transaction,
  token: string,
  input: QuoteLinkDecisionInput,
  ctx: QuoteLinkRequestContext,
): Promise<QuoteLinkDecisionOutcome> {
  // Re-resolve in this transaction: the submit, not the rendered page, is the authority.
  const resolved = await QuoteAccessLinks.resolve(token, { ip: ctx.ip }, trx);
  if (resolved.status !== 'ok') return INVALID_LINK;

  const { tenant, quote, link, recipient } = resolved;

  if (resolved.readOnly || quote.status !== 'sent') {
    return settledOutcome(trx, tenant, quote.quote_id);
  }

  const optionalRows = await tenantDb(trx, tenant)
    .table('quote_items')
    .where({ quote_id: quote.quote_id, is_optional: true })
    .select<Array<{ quote_item_id: string }>>('quote_item_id');
  const problem = validate(input, new Set(optionalRows.map((r) => r.quote_item_id)));
  if (problem) return { status: 'invalid_input', problem };

  const accepting = input.action === 'accept';
  const agreement = getCurrentQuoteAgreement();
  const result = await decideQuote(
    {
      tenantId: tenant,
      quoteId: quote.quote_id,
      action: input.action,
      actor: {
        kind: 'access_link',
        linkId: link.link_id,
        contactId: recipient.contactId,
        email: recipient.email,
      },
      // The signer's email comes from the link, never from the form.
      signer: accepting
        ? { name: input.signer!.name!.trim(), email: recipient.email, title: input.signer?.title?.trim() || null }
        : { email: recipient.email },
      context: {
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        agreementTextHash: accepting ? agreement.hash : null,
        agreementVersion: accepting ? agreement.version : null,
      },
      selections: accepting ? { selectedOptionalQuoteItemIds: input.selectedOptionalQuoteItemIds ?? [] } : undefined,
      comment: accepting ? null : input.comment!.trim(),
    },
    trx,
  );

  switch (result.status) {
    case 'decided': {
      const row = await latestDecision(trx, tenant, quote.quote_id);
      return {
        status: 'decided',
        decision: accepting ? 'accepted' : 'rejected',
        decidedAt: row ? iso(row.decided_at) : new Date().toISOString(),
      };
    }
    case 'already_decided':
    case 'not_pending': {
      // Lost a race or repeated a submit, or the MSP moved the quote underneath the page.
      return settledOutcome(trx, tenant, quote.quote_id);
    }
    case 'not_found':
    case 'forbidden':
      return INVALID_LINK;
  }
}

/**
 * Accept or reject a quote through an email-link token. Safe to call from an
 * unauthenticated route; never throws for link problems.
 */
export async function submitQuoteLinkDecision(
  token: string,
  input: QuoteLinkDecisionInput,
  ctx: QuoteLinkRequestContext = {},
): Promise<QuoteLinkDecisionOutcome> {
  if (!isWellFormedQuoteAccessToken(token) || !input || typeof input !== 'object') return INVALID_LINK;
  const knex = await getConnection();
  return withTransaction(knex, (trx: Knex.Transaction) => submitInTransaction(trx, token, input, ctx));
}
