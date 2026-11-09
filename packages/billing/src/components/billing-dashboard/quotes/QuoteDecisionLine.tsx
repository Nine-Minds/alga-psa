'use client';

import React from 'react';
import type { IQuoteDecisionSummary } from '@alga-psa/types';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

/** "Jane Doe (jane@client.com)"; either part may be missing. */
export function formatDecisionSigner(decision: Pick<IQuoteDecisionSummary, 'signer_name' | 'signer_email'>): string {
  const name = decision.signer_name?.trim();
  const email = decision.signer_email?.trim();
  if (name && email && name.toLowerCase() !== email.toLowerCase()) return `${name} (${email})`;
  return name || email || '';
}

/**
 * The email-link decision a given activity row records, looked up by the `decision_id`
 * decideQuote writes into the activity metadata. Activities without one (legacy rows,
 * other writers) return null and the caller renders their description.
 */
export function emailLinkDecisionForActivity(
  decisions: IQuoteDecisionSummary[] | undefined,
  activity: { activity_type: string; metadata?: Record<string, unknown> | null },
): IQuoteDecisionSummary | null {
  if (!decisions?.length) return null;
  if (activity.activity_type !== 'accepted' && activity.activity_type !== 'rejected') return null;
  const decisionId = activity.metadata?.decision_id;
  if (typeof decisionId !== 'string') return null;
  const decision = decisions.find((d) => d.decision_id === decisionId);
  return decision?.method === 'email_link' ? decision : null;
}

/**
 * One-line description of a recorded quote decision, rendered from `quote_decisions`
 * (not from `quotes.accepted_by`, which is null for an email-link signer without a users row).
 */
export const QuoteDecisionLine: React.FC<{ decision: IQuoteDecisionSummary }> = ({ decision }) => {
  const { t } = useTranslation('msp/quotes');
  const { formatDate } = useFormatters();
  const signer = formatDecisionSigner(decision);
  const date = formatDate(decision.decided_at);
  const vars = { signer, date };

  let text: string;
  if (decision.decision === 'accepted') {
    if (decision.method === 'email_link') {
      text = t('quoteDecision.accepted.emailLink', { defaultValue: 'Accepted by {{signer}} via email link, {{date}}', ...vars });
    } else if (decision.method === 'portal') {
      text = t('quoteDecision.accepted.portal', { defaultValue: 'Accepted by {{signer}} via the client portal, {{date}}', ...vars });
    } else {
      text = t('quoteDecision.accepted.mspMarked', { defaultValue: 'Marked as accepted by MSP on behalf of the client, {{date}}', ...vars });
    }
  } else if (decision.method === 'email_link') {
    text = t('quoteDecision.rejected.emailLink', { defaultValue: 'Rejected by {{signer}} via email link, {{date}}', ...vars });
  } else {
    text = t('quoteDecision.rejected.portal', { defaultValue: 'Rejected by {{signer}} via the client portal, {{date}}', ...vars });
  }

  return (
    <span data-testid="quote-decision-line">
      {text}
      {decision.signer_title ? (
        <span className="text-muted-foreground">
          {' '}
          {t('quoteDecision.title', { defaultValue: '({{title}})', title: decision.signer_title })}
        </span>
      ) : null}
    </span>
  );
};

export default QuoteDecisionLine;
