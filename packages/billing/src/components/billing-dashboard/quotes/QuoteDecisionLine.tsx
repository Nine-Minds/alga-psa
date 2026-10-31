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
 * The email-link decision a given activity row records, if any. decideQuote writes exactly
 * one `accepted`/`rejected` activity per decision, in the same order, so the Nth such
 * activity of a type pairs with the Nth decision of that type.
 */
export function emailLinkDecisionForActivity(
  decisions: IQuoteDecisionSummary[] | undefined,
  activities: Array<{ activity_id: string; activity_type: string; created_at?: unknown }> | undefined,
  activity: { activity_id: string; activity_type: string },
): IQuoteDecisionSummary | null {
  if (!decisions?.length || !activities) return null;
  const kind = activity.activity_type === 'accepted' ? 'accepted' : activity.activity_type === 'rejected' ? 'rejected' : null;
  if (!kind) return null;
  const chrono = (a: { created_at?: unknown }, b: { created_at?: unknown }) =>
    new Date(String(a.created_at ?? 0)).getTime() - new Date(String(b.created_at ?? 0)).getTime();
  const sameKindActivities = activities.filter((a) => a.activity_type === kind).sort(chrono);
  const sameKindDecisions = decisions.filter((d) => d.decision === kind)
    .sort((a, b) => new Date(a.decided_at).getTime() - new Date(b.decided_at).getTime());
  const index = sameKindActivities.findIndex((a) => a.activity_id === activity.activity_id);
  const decision = index >= 0 ? sameKindDecisions[index] : undefined;
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
