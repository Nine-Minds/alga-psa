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
import { computePublicQuoteFingerprint } from './publicQuoteView';
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
  /** Fingerprint of the public quote content the signer was shown (computePublicQuoteFingerprint). */
  quoteFingerprint?: string | null;
  selectedOptionalQuoteItemIds?: string[];
  comment?: string | null;
}

export interface QuoteLinkRequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

/** A decision this module committed: what post-commit work needs, never sent to the browser. */
export interface CommittedQuoteLinkDecision {
  tenant: string;
  quoteId: string;
  decisionId: string;
  decision: 'accepted' | 'rejected';
}

export interface QuoteLinkDecisionHooks {
  /**
   * Runs once the decision's transaction has committed, never inside it. A throw is
   * logged and swallowed: the decision stands whatever post-commit work does.
   */
  afterCommit?: (committed: CommittedQuoteLinkDecision) => void | Promise<void>;
}

export type QuoteLinkInputProblem =
  | 'name_required'
  | 'agreement_required'
  | 'agreement_outdated'
  | 'comment_required'
  | 'invalid_selection'
  | 'too_long'
  | 'invalid_action'
  | 'fingerprint_required';

/** The quote as persisted by the decision transaction (minor units, as on the quotes row). */
export interface QuoteLinkCommittedSnapshot {
  subtotal: number;
  discount_total: number;
  tax: number;
  total_amount: number;
  /** Optional items that are selected after the decision. */
  selectedOptionalQuoteItemIds: string[];
}

export type QuoteLinkDecisionOutcome =
  | { status: 'decided'; decision: 'accepted' | 'rejected'; decidedAt: string; committed: QuoteLinkCommittedSnapshot }
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

/** Input shape only; needs no quote data. Optional-item membership is checked separately, after the fingerprint. */
function validateShape(input: QuoteLinkDecisionInput): QuoteLinkInputProblem | null {
  const L = QUOTE_LINK_DECISION_LIMITS;
  if (input.action === 'reject') {
    const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
    if (!comment) return 'comment_required';
    if (comment.length > L.comment) return 'too_long';
    return typeof input.quoteFingerprint === 'string' ? null : 'fingerprint_required';
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
  return typeof input.quoteFingerprint === 'string' ? null : 'fingerprint_required';
}

function validateSelectionMembership(input: QuoteLinkDecisionInput, optionalItemIds: Set<string>): QuoteLinkInputProblem | null {
  if (input.action !== 'accept') return null;
  for (const id of input.selectedOptionalQuoteItemIds ?? []) {
    if (typeof id !== 'string' || !optionalItemIds.has(id)) return 'invalid_selection';
  }
  return null;
}

/** Re-read the quote as persisted (same transaction) so the caller renders what was committed, not what it sent. */
async function readCommittedSnapshot(
  trx: Knex.Transaction,
  tenant: string,
  quoteId: string,
): Promise<QuoteLinkCommittedSnapshot> {
  const row = await tenantDb(trx, tenant)
    .table('quotes')
    .where({ quote_id: quoteId })
    .first<{ subtotal: unknown; discount_total: unknown; tax: unknown; total_amount: unknown }>(
      'subtotal', 'discount_total', 'tax', 'total_amount',
    );
  const selected = await tenantDb(trx, tenant)
    .table('quote_items')
    .where({ quote_id: quoteId, is_optional: true, is_selected: true })
    .orderBy('display_order')
    .select<Array<{ quote_item_id: string }>>('quote_item_id');
  return {
    subtotal: Number(row?.subtotal ?? 0),
    discount_total: Number(row?.discount_total ?? 0),
    tax: Number(row?.tax ?? 0),
    total_amount: Number(row?.total_amount ?? 0),
    selectedOptionalQuoteItemIds: selected.map((r) => r.quote_item_id),
  };
}

type TransactionResult = { outcome: QuoteLinkDecisionOutcome; committed?: CommittedQuoteLinkDecision };

async function submitInTransaction(
  trx: Knex.Transaction,
  token: string,
  input: QuoteLinkDecisionInput,
  ctx: QuoteLinkRequestContext,
): Promise<TransactionResult> {
  const committed: { value?: CommittedQuoteLinkDecision } = {};
  const outcome = await decideInTransaction(trx, token, input, ctx, committed);
  return { outcome, committed: committed.value };
}

async function decideInTransaction(
  trx: Knex.Transaction,
  token: string,
  input: QuoteLinkDecisionInput,
  ctx: QuoteLinkRequestContext,
  committed: { value?: CommittedQuoteLinkDecision },
): Promise<QuoteLinkDecisionOutcome> {
  // Re-resolve in this transaction: the submit, not the rendered page, is the authority.
  const resolved = await QuoteAccessLinks.resolve(token, { ip: ctx.ip }, trx);
  if (resolved.status !== 'ok') return INVALID_LINK;

  const { tenant, quote, link, recipient } = resolved;

  if (resolved.readOnly || quote.status !== 'sent') {
    return settledOutcome(trx, tenant, quote.quote_id);
  }

  // Content check. The signature must bind to the content the signer saw, and a `sent`
  // quote stays editable server-side, so status alone is not enough. Lock the quote row
  // (updateQuote / resend wait for it) and its item rows (item edits wait for them), then
  // recompute the fingerprint of the public projection and compare. Under READ COMMITTED
  // the statements after the lock see everything committed before it was granted, and any
  // edit that needed one of these locks is ordered after our commit, i.e. after the
  // signature. An item INSERT takes no lock on existing rows, but it can only commit
  // after our fingerprint read or before it; before => we see it and refuse, after =>
  // the edit is ordered after the signature, which signed exactly the verified content.
  const locked = await tenantDb(trx, tenant)
    .table('quotes')
    .where({ quote_id: quote.quote_id })
    .forUpdate()
    .first<{ status: string } | undefined>('status');
  await tenantDb(trx, tenant)
    .table('quote_items')
    .where({ quote_id: quote.quote_id })
    .forUpdate()
    .select('quote_item_id');
  // A competing decision/edit may have committed while we waited for the lock.
  if (!locked || locked.status !== 'sent') {
    return settledOutcome(trx, tenant, quote.quote_id);
  }
  const shapeProblem = validateShape(input);
  if (shapeProblem) return { status: 'invalid_input', problem: shapeProblem };
  const fingerprint = await computePublicQuoteFingerprint(trx, tenant, quote.quote_id);
  if (!fingerprint || input.quoteFingerprint !== fingerprint) {
    return { status: 'changed' };
  }

  const optionalRows = await tenantDb(trx, tenant)
    .table('quote_items')
    .where({ quote_id: quote.quote_id, is_optional: true })
    .select<Array<{ quote_item_id: string }>>('quote_item_id');
  const problem = validateSelectionMembership(input, new Set(optionalRows.map((r) => r.quote_item_id)));
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
        contentFingerprint: fingerprint,
      },
      selections: accepting ? { selectedOptionalQuoteItemIds: input.selectedOptionalQuoteItemIds ?? [] } : undefined,
      comment: accepting ? null : input.comment!.trim(),
    },
    trx,
  );

  switch (result.status) {
    case 'decided': {
      committed.value = {
        tenant,
        quoteId: quote.quote_id,
        decisionId: result.decisionId,
        decision: accepting ? 'accepted' : 'rejected',
      };
      const row = await latestDecision(trx, tenant, quote.quote_id);
      return {
        status: 'decided',
        decision: accepting ? 'accepted' : 'rejected',
        decidedAt: row ? iso(row.decided_at) : new Date().toISOString(),
        committed: await readCommittedSnapshot(trx, tenant, quote.quote_id),
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
  hooks: QuoteLinkDecisionHooks = {},
): Promise<QuoteLinkDecisionOutcome> {
  if (!isWellFormedQuoteAccessToken(token) || !input || typeof input !== 'object') return INVALID_LINK;
  const knex = await getConnection();
  const { outcome, committed } = await withTransaction(knex, (trx: Knex.Transaction) =>
    submitInTransaction(trx, token, input, ctx),
  );
  if (committed && hooks.afterCommit) {
    try {
      await hooks.afterCommit(committed);
    } catch (error) {
      console.error(
        `Post-commit work failed for quote ${committed.quoteId} decision ${committed.decisionId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return outcome;
}
