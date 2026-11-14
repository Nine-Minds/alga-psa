import logger from '@alga-psa/core/logger';
import { finalizeLinkAcceptedQuote } from '@alga-psa/billing/services';
import type { CommittedQuoteLinkDecision } from '@alga-psa/billing/services';

export const FINALIZE_LINK_ACCEPTED_QUOTE_JOB = 'finalize-link-accepted-quote';

export interface FinalizeLinkAcceptedQuoteJobData extends Record<string, unknown> {
  tenantId: string;
  quoteId: string;
  decisionId: string;
}

/**
 * The signed copy and the signer's confirmation for a quote accepted through an
 * emailed link. The finalizer is idempotent (the signed document is refreshed in
 * place, the email goes out at most once), so a run that reports problems throws
 * and the runner retries it.
 */
export async function finalizeLinkAcceptedQuoteHandler(data: FinalizeLinkAcceptedQuoteJobData): Promise<void> {
  const { tenantId, quoteId, decisionId } = data;
  if (!tenantId || !quoteId || !decisionId) {
    logger.warn('[FinalizeLinkAcceptedQuoteJob] Missing tenantId, quoteId or decisionId', { tenantId, quoteId, decisionId });
    return;
  }

  const result = await finalizeLinkAcceptedQuote(tenantId, quoteId, decisionId);
  logger.info('[FinalizeLinkAcceptedQuoteJob] Finalized', {
    tenantId,
    quoteId,
    decisionId,
    documentId: result.documentId ?? null,
    emailSent: result.emailSent,
    errors: result.errors,
  });
  if (result.errors.length > 0) {
    throw new Error(`Quote ${quoteId} acceptance finalization incomplete: ${result.errors.join('; ')}`);
  }
}

/**
 * `afterCommit` hook for `submitQuoteLinkDecision`: queue the signed copy for a
 * committed acceptance. One job per decision (singleton key), so a repeated
 * enqueue for the same acceptance is a no-op.
 */
export async function enqueueLinkAcceptanceFinalization(committed: CommittedQuoteLinkDecision): Promise<void> {
  if (committed.decision !== 'accepted') {
    return;
  }
  // Lazy: the factory registers every handler, this module among them.
  const { getJobRunner } = await import('../JobRunnerFactory');
  const runner = await getJobRunner();
  await runner.scheduleJob<FinalizeLinkAcceptedQuoteJobData>(
    FINALIZE_LINK_ACCEPTED_QUOTE_JOB,
    { tenantId: committed.tenant, quoteId: committed.quoteId, decisionId: committed.decisionId },
    { singletonKey: `${FINALIZE_LINK_ACCEPTED_QUOTE_JOB}:${committed.tenant}:${committed.decisionId}` },
  );
}
