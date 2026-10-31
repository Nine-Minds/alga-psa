import type { Knex } from 'knex';
import { createTenantKnex, resolveEffectiveTimeZone, runWithTenant } from '@alga-psa/db';
import { TenantEmailService } from '@alga-psa/email';
import { resolveEmailLocale } from '@alga-psa/notifications/notifications/emailLocaleResolver';
import { StorageProviderFactory } from '@alga-psa/storage';
import { fetchTenantParty } from '../lib/adapters/tenantPartyAdapter';
import { QUOTE_ACTIVITY_TYPES } from '../lib/quoteActivityTypes';
import type { QuoteAcceptanceDetails } from '../lib/quoteAcceptance';
import { renderQuoteEmail } from '../lib/quoteEmailRendering';
import { getQuotePdfFileName } from '../lib/quoteFileNames';
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
 * CALLER CONTRACT (the public accept handler, card 4 of alga-2026-0002820):
 *  1. Commit the decision first, in its own transaction. Call this only after
 *     that commit — never inside it. A PDF or email failure here can neither
 *     roll back nor block an acceptance, and this function never throws.
 *  2. Inside the decision transaction, do exactly what `acceptClientQuote`
 *     (client-portal client-billing.ts) does: `Quote.update` to `accepted`, then
 *     `QuoteActivity.create({ activity_type: 'accepted' })`, then
 *     `onQuoteAccepted(trx, quote)`. That is the whole MSP-facing side of a
 *     portal acceptance — it sends no MSP email and publishes no event — so a
 *     link acceptance gets the identical signal by calling the same three
 *     things. This function deliberately adds no MSP notification of its own.
 *
 * Gates and guarantees:
 *  - No half-confirmation: the signer email is sent only once the signed PDF
 *    exists as a filed document. If it could not be produced or filed, no email.
 *  - Idempotent: the signed document is reused if it already exists (the PDF
 *    service files `-signed` with `refresh` semantics under an advisory lock),
 *    and the signer email is skipped when a `signer_confirmation_sent` activity
 *    is already on the quote. The sent PDF is never touched.
 */
export async function finalizeLinkAcceptedQuote(
  tenant: string,
  quoteId: string,
  acceptance: QuoteAcceptanceDetails
): Promise<FinalizeLinkAcceptedQuoteResult> {
  const result: FinalizeLinkAcceptedQuoteResult = { emailSent: false, errors: [] };

  try {
    await runWithTenant(tenant, async () => {
      const { knex } = await createTenantKnex(tenant);
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
  let stored;
  try {
    const timeZone = await resolveEffectiveTimeZone(knex, tenant);
    stored = await createPDFGenerationService(tenant).generateAndStore({
      quoteId,
      quoteNumber: quote.quote_number ?? undefined,
      userId: quote.accepted_by ?? quote.updated_by ?? quote.created_by ?? 'system',
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
    const alreadySent = (await QuoteActivity.listByQuoteId(knex, tenant, quoteId)).some(
      (activity) => activity.activity_type === QUOTE_ACTIVITY_TYPES.signerConfirmationSent
    );
    if (alreadySent) {
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
    const emailResult = await TenantEmailService.getInstance(tenant).sendEmail({
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

    if (!emailResult.success) {
      result.errors.push(`Signer confirmation email failed: ${emailResult.error ?? 'unknown error'}`);
      return;
    }
    result.emailSent = true;

    try {
      await QuoteActivity.create(knex, tenant, {
        quote_id: quoteId,
        activity_type: QUOTE_ACTIVITY_TYPES.signerConfirmationSent,
        description: `Signed quote copy emailed to ${signerEmail}`,
        performed_by: null,
        metadata: { recipient: signerEmail, document_id: stored.document_id, message_id: emailResult.messageId ?? null },
      });
    } catch (activityError) {
      // The email is out; failing to log it must not turn into a failure report.
      console.warn(`Could not record the signer confirmation for quote ${quoteId}:`, activityError);
    }
  } catch (error) {
    console.error(`Signer confirmation email failed for quote ${quoteId}:`, error);
    result.errors.push(`Signer confirmation email failed: ${errorMessage(error)}`);
  }
}
