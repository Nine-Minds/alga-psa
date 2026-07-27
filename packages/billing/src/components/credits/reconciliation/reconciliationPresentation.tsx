'use client';

import type { ReactNode } from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import type { ICreditReconciliationReport, ReconciliationStatus } from '@alga-psa/types';
import type { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type TFunction = ReturnType<typeof useTranslation>['t'];

/** Discrepancy categories the fix engine distinguishes between. */
export type ReconciliationIssueType =
  | 'missing_credit_tracking_entry'
  | 'inconsistent_credit_remaining_amount'
  | 'balance_discrepancy';

export function getIssueType(report: Pick<ICreditReconciliationReport, 'metadata'>): ReconciliationIssueType {
  const issueType = report.metadata?.issue_type;
  if (issueType === 'missing_credit_tracking_entry' || issueType === 'inconsistent_credit_remaining_amount') {
    return issueType;
  }
  return 'balance_discrepancy';
}

export function getIssueTypeLabel(t: TFunction, report: Pick<ICreditReconciliationReport, 'metadata'>): string {
  switch (getIssueType(report)) {
    case 'missing_credit_tracking_entry':
      return t('reconciliation.issueTypes.missingCreditTrackingEntry', { defaultValue: 'Missing Credit Tracking Entry' });
    case 'inconsistent_credit_remaining_amount':
      return t('reconciliation.issueTypes.inconsistentCreditRemainingAmount', { defaultValue: 'Inconsistent Credit Remaining Amount' });
    default:
      return t('reconciliation.issueTypes.balanceDiscrepancy', { defaultValue: 'Credit Balance Discrepancy' });
  }
}

export function getStatusBadge(t: TFunction, status: ReconciliationStatus): ReactNode {
  switch (status) {
    case 'resolved':
      return (
        <Badge className="bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-900))]">
          {t('status.resolved', { defaultValue: 'Resolved' })}
        </Badge>
      );
    case 'in_review':
      return (
        <Badge className="bg-[rgb(var(--color-secondary-100))] text-[rgb(var(--color-secondary-900))]">
          {t('status.inReview', { defaultValue: 'In Review' })}
        </Badge>
      );
    default:
      return (
        <Badge className="bg-[rgb(var(--color-accent-100))] text-[rgb(var(--color-accent-900))]">
          {t('status.open', { defaultValue: 'Open' })}
        </Badge>
      );
  }
}
