import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createTenantKnex, resolveEffectiveTimeZone, runWithTenant, withTransaction } from '@alga-psa/db';
import { TenantEmailService } from '@alga-psa/email';
import { resolveEmailLocale } from '@alga-psa/notifications/notifications/emailLocaleResolver';
import { StorageProviderFactory } from '@alga-psa/storage';
import { fetchTenantParty } from '../lib/adapters/tenantPartyAdapter';
import { QUOTE_ACTIVITY_TYPES } from '../lib/quoteActivityTypes';
import { loadQuoteAcceptance, type QuoteAcceptanceDetails } from '../lib/quoteAcceptance';
import { renderQuoteEmail } from '../lib/quoteEmailRendering';
import { getQuotePdfFileName } from '../lib/quoteFileNames';
import type { IQuoteActivity } from '@alga-psa/types';
import Quote from '../models/quote';
import QuoteActivity from '../models/quoteActivity';
import { SIGNED_QUOTE_FILE_SUFFIX, createPDFGenerationService } from './pdfGenerationService';

export interface FinalizeLinkAcceptedQuoteResult {
  /** The signed copy's `documents` row, when it was produced and filed. */
  documentId?: string;
  /** True only when the signer confirmation email was handed to the mail service. */
  emailSent: boolean;
  /** Everything that went wrong or was skipped, in order. Empty on a clean run. */
  errors: string[];
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * What happens after a quote is accepted through an emailed link: the quote PDF
 * is rendered again with the acceptance block, filed as a new client-visible
 * `-signed` document linked to the quote, and mailed to the signer.
 *
 * Runs after the decision has committed — never inside its transaction — so a
 * PDF or email failure can neither roll back nor block an acceptance. The
 * public decision route enqueues it as the `finalize-link-accepted-quote` job
 * once `submitQuoteLinkDecision` reports a committed acceptance. Everything it
 * stamps (typed name, email, title, time, method, IP) is read from that
 * decision's `quote_decisions` row, never from the caller. It never throws.
 *
 * It adds no MSP notification: `decideQuote` already writes the same
 * `accepted` activity and runs the same `onQuoteAccepted` hook for a link
 * acceptance as for a portal one, so the MSP sees the identical signal.
 *
 * Gates and guarantees:
 *  - No half-confirmation: the signer email is sent only once the signed PDF
 *    exists as a filed document. If it could not be produced or filed, no email.
 *  - Idempotent: the signed document is reused if it already exists (the PDF
 *    service files `-signed` with `refresh` semantics under an advisory lock),
 *    and the signer email is sent at most once. A run claims the send by
 *    appending a `signer_confirmation_claimed` activity under a per-quote
 *    advisory lock (a brief transaction), sends outside any transaction, then
 *    appends `signer_confirmation_sent` (terminal) or `signer_confirmation_failed`
 *    (releases the claim for a retry). A claim left behind by a dead process
 *    goes stale after 15 minutes. The sent PDF is never touched.
 */
export async function finalizeLinkAcceptedQuote(
  tenant: string,
  quoteId: string,
  decisionId: string
): Promise<FinalizeLinkAcceptedQuoteResult> {
  const result: FinalizeLinkAcceptedQuoteResult = { emailSent: false, errors: [] };

  try {
    await runWithTenant(tenant, async () => {
      const { knex } = await createTenantKnex(tenant);
      const acceptance = await loadQuoteAcceptance(knex, tenant, quoteId, { decisionId });
      if (!acceptance) {
        result.errors.push(`No accepted decision ${decisionId} recorded for quote ${quoteId}`);
        return;
      }
      if (acceptance.method !== 'email_link') {
        result.errors.push(`Decision ${decisionId} was not made through an emailed link; nothing to finalize`);
        return;
      }
      await finalize(knex, tenant, quoteId, acceptance, result);
    });
  } catch (error) {
    console.error(`Quote acceptance finalization failed for quote ${quoteId}:`, error);
    result.errors.push(errorMessage(error));
  }

  return result;
}

async function finalize(
  knex: Knex,
  tenant: string,
  quoteId: string,
  acceptance: QuoteAcceptanceDetails,
  result: FinalizeLinkAcceptedQuoteResult
): Promise<void> {
  const quote = await Quote.getById(knex, tenant, quoteId);
  if (!quote) {
    result.errors.push(`Quote ${quoteId} not found`);
    return;
  }
  if (quote.status !== 'accepted') {
    result.errors.push(`Quote ${quoteId} is not accepted; the decision must be committed before finalizing`);
    return;
  }

  // ---- Signed PDF: render, file ------------------------------------------
  // A link acceptance has no accepting user, so the file and document are
  // attributed to the quote's own users. Their columns are user FKs: a made-up
  // actor would only fail at the insert, so say so plainly instead.
  const actorUserId = quote.accepted_by ?? quote.updated_by ?? quote.created_by;
  if (!actorUserId) {
    result.errors.push('Quote has no user to attribute the signed copy to; signed PDF not produced');
    return;
  }

  let stored;
  try {
    // Tenant zone (no user passed): tenant_settings timezone, else UTC.
    const timeZone = await resolveEffectiveTimeZone(knex, tenant);
    stored = await createPDFGenerationService(tenant).generateAndStore({
      quoteId,
      quoteNumber: quote.quote_number ?? undefined,
      userId: actorUserId,
      quoteVariant: 'signed',
      acceptance: { ...acceptance, timeZone },
    });
  } catch (error) {
    console.error(`Failed to produce the signed PDF for quote ${quoteId}:`, error);
    result.errors.push(`Signed PDF could not be produced: ${errorMessage(error)}`);
    return;
  }

  // The PDF service swallows filing failures (the file exists, the document row
  // does not). A signed copy that is not filed is not a signed copy.
  if (!stored.document_id) {
    result.errors.push('Signed PDF was produced but could not be filed as a document');
    return;
  }
  result.documentId = stored.document_id;

  // ---- Signer confirmation email -----------------------------------------
  const signerEmail = acceptance.signerEmail?.trim();
  if (!signerEmail) {
    result.errors.push('No signer email on the acceptance; confirmation email not sent');
    return;
  }

  try {
    // Fast path: skip the render and download when the confirmation is already
    // out or another run is sending it.
    if (!isSignerConfirmationClaimable(await QuoteActivity.listByQuoteId(knex, tenant, quoteId))) {
      return;
    }

    const provider = await StorageProviderFactory.createProvider();
    const pdfBuffer = await provider.download(stored.storage_path);

    const [tenantParty, locale] = await Promise.all([
      fetchTenantParty(knex, tenant),
      resolveEmailLocale(tenant, {
        email: signerEmail,
        userType: 'client',
        ...(quote.client_id ? { clientId: quote.client_id } : {}),
      }).catch(() => 'en'),
    ]);

    const acceptedAtIso = new Date(acceptance.acceptedAt).toISOString();
    const rendered = await renderQuoteEmail({
      knex,
      tenant,
      templateName: 'quote-accepted-confirmation-email',
      quote: { ...quote, accepted_at: acceptedAtIso },
      companyName: tenantParty?.name || 'Your Company',
      locale,
    });

    const sentName = getQuotePdfFileName(quote).replace(/\.pdf$/i, '');

    // Claim the send first, in a short transaction under a per-quote advisory
    // lock, then send with no lock and no connection held: an SMTP call can be
    // slow and must not pin a pooled DB connection. A run that finds a live
    // claim (or a sent record) stands down, so racing runs send once.
    const claimId = await claimSignerConfirmation(knex, tenant, quoteId, {
      recipient: signerEmail,
      documentId: stored.document_id,
    });
    if (!claimId) {
      return;
    }

    let emailResult: Awaited<ReturnType<ReturnType<typeof TenantEmailService.getInstance>['sendEmail']>>;
    try {
      emailResult = await TenantEmailService.getInstance(tenant).sendEmail({
        mailClass: 'sales',
        tenantId: tenant,
        to: [signerEmail],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        attachments: [
          {
            filename: stored.original_name || `${sentName}${SIGNED_QUOTE_FILE_SUFFIX}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
        entityType: 'quote',
        entityId: quoteId,
        contactId: acceptance.signerContactId ?? quote.contact_id ?? undefined,
      });
    } catch (sendError) {
      await recordSignerConfirmation(knex, tenant, quoteId, QUOTE_ACTIVITY_TYPES.signerConfirmationFailed, {
        claim_id: claimId,
        recipient: signerEmail,
        error: errorMessage(sendError),
      });
      throw sendError;
    }

    if (!emailResult.success) {
      const failure = emailResult.error ?? 'unknown error';
      await recordSignerConfirmation(knex, tenant, quoteId, QUOTE_ACTIVITY_TYPES.signerConfirmationFailed, {
        claim_id: claimId,
        recipient: signerEmail,
        error: failure,
      });
      result.errors.push(`Signer confirmation email failed: ${failure}`);
      return;
    }
    result.emailSent = true;

    // The email is out; failing to log it must not turn into a failure report.
    // (If this write is lost the claim goes stale and a much later run may
    // resend — the one accepted at-least-once edge of a non-transactional SMTP.)
    await recordSignerConfirmation(knex, tenant, quoteId, QUOTE_ACTIVITY_TYPES.signerConfirmationSent, {
      claim_id: claimId,
      recipient: signerEmail,
      document_id: stored.document_id,
      message_id: emailResult.messageId ?? null,
    });
  } catch (error) {
    console.error(`Signer confirmation email failed for quote ${quoteId}:`, error);
    result.errors.push(`Signer confirmation email failed: ${errorMessage(error)}`);
  }
}

/** A claim older than this is presumed dead (process died mid-send) and may be retaken. */
const SIGNER_CONFIRMATION_CLAIM_TTL_MS = 15 * 60 * 1000;

/**
 * Whether a run may send the confirmation, given the quote's activity log.
 *
 * `sent` is terminal for the quote. A `claimed` row is live until a `failed`
 * row with the same `claim_id` supersedes it, or until it is older than the TTL
 * (its process presumably died). Matching by `claim_id`, not by position, keeps
 * a late `failed` from an old, stale run from releasing a newer run's live claim.
 * The send is free only when no live claim remains.
 */
function isSignerConfirmationClaimable(activities: IQuoteActivity[], now = Date.now()): boolean {
  if (activities.some((a) => a.activity_type === QUOTE_ACTIVITY_TYPES.signerConfirmationSent)) {
    return false;
  }

  const claimIdOf = (a: IQuoteActivity): unknown => a.metadata?.claim_id;
  const released = new Set(
    activities
      .filter((a) => a.activity_type === QUOTE_ACTIVITY_TYPES.signerConfirmationFailed)
      .map(claimIdOf)
      .filter((id): id is string => typeof id === 'string')
  );

  return !activities.some((a) => {
    if (a.activity_type !== QUOTE_ACTIVITY_TYPES.signerConfirmationClaimed) return false;
    const claimId = claimIdOf(a);
    if (typeof claimId === 'string' && released.has(claimId)) return false;
    const claimedAt = a.created_at ? new Date(a.created_at).getTime() : Number.NaN;
    // An unreadable timestamp is treated as live: not sending is the safe side.
    return Number.isNaN(claimedAt) || now - claimedAt <= SIGNER_CONFIRMATION_CLAIM_TTL_MS;
  });
}

/**
 * Takes the right to send the confirmation: under a per-quote advisory lock,
 * re-checks the log and appends a `claimed` row. Returns the claim id, or null
 * when the send is already done or in progress elsewhere. The transaction is
 * brief and ends before any email work.
 */
async function claimSignerConfirmation(
  knex: Knex,
  tenant: string,
  quoteId: string,
  details: { recipient: string; documentId: string }
): Promise<string | null> {
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', [
      'alga:quote-signer-confirmation',
      `${tenant}:${quoteId}`,
    ]);

    if (!isSignerConfirmationClaimable(await QuoteActivity.listByQuoteId(trx, tenant, quoteId))) {
      return null;
    }

    const claimId = randomUUID();
    await QuoteActivity.create(trx, tenant, {
      quote_id: quoteId,
      activity_type: QUOTE_ACTIVITY_TYPES.signerConfirmationClaimed,
      description: `Sending signed quote copy to ${details.recipient}`,
      performed_by: null,
      metadata: { claim_id: claimId, recipient: details.recipient, document_id: details.documentId },
    });
    return claimId;
  });
}

/** Appends the outcome of a claimed send. Best effort: never throws. */
async function recordSignerConfirmation(
  knex: Knex,
  tenant: string,
  quoteId: string,
  activityType: typeof QUOTE_ACTIVITY_TYPES.signerConfirmationSent | typeof QUOTE_ACTIVITY_TYPES.signerConfirmationFailed,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    const sent = activityType === QUOTE_ACTIVITY_TYPES.signerConfirmationSent;
    await QuoteActivity.create(knex, tenant, {
      quote_id: quoteId,
      activity_type: activityType,
      description: sent
        ? `Signed quote copy emailed to ${String(metadata.recipient)}`
        : `Signed quote copy could not be emailed to ${String(metadata.recipient)}`,
      performed_by: null,
      metadata,
    });
  } catch (activityError) {
    console.warn(`Could not record the signer confirmation outcome for quote ${quoteId}:`, activityError);
  }
}
