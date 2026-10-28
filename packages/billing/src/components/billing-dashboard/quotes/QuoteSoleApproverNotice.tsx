'use client';

import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export type QuoteSoleApproverNoticeContext = 'settings' | 'draft' | 'pending';

interface QuoteSoleApproverNoticeProps {
  id: string;
  /** Where the notice is shown: the approvals dashboard, a draft quote, or a quote pending approval. */
  context: QuoteSoleApproverNoticeContext;
}

/**
 * Tells the current user they are the tenant's only possible quote approver, so a quote
 * awaiting approval is never a dead end: they can approve their own quotes
 * (alga-2026-0002597). Render only when approval is required and
 * `getQuoteApprovalSettings().currentUserIsSoleApprover` is true.
 */
const QuoteSoleApproverNotice: React.FC<QuoteSoleApproverNoticeProps> = ({ id, context }) => {
  const { t } = useTranslation('msp/quotes');

  const description = context === 'pending'
    ? t('quoteApproval.soleApprover.pendingDescription', {
      defaultValue: 'You are the only user who can approve quotes, so you can approve this quote yourself. Choose Approve to make it ready to send.',
    })
    : context === 'draft'
      ? t('quoteApproval.soleApprover.draftDescription', {
        defaultValue: 'You are the only user who can approve quotes. After you submit this quote for approval, you can approve it yourself and then send it.',
      })
      : t('quoteApproval.soleApprover.description', {
        defaultValue: 'No other active user can approve quotes, so you can approve your own quotes. Self-approvals are recorded in the quote activity.',
      });

  return (
    <Alert id={id}>
      <AlertTitle>
        {t('quoteApproval.soleApprover.title', { defaultValue: 'You are the only quote approver' })}
      </AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
};

export default QuoteSoleApproverNotice;
