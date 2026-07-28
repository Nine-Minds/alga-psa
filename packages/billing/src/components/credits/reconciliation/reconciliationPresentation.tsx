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
  | 'balance_discrepancy'
  | 'unknown';

export function getIssueType(report: Pick<ICreditReconciliationReport, 'metadata'>): ReconciliationIssueType {
  const issueType = report.metadata?.issue_type;
  if (
    issueType === 'missing_credit_tracking_entry' ||
    issueType === 'inconsistent_credit_remaining_amount' ||
    issueType === 'balance_discrepancy'
  ) {
    return issueType;
  }
  return 'unknown';
}

export function getIssueTypeLabel(t: TFunction, report: Pick<ICreditReconciliationReport, 'metadata'>): string {
  switch (getIssueType(report)) {
    case 'missing_credit_tracking_entry':
      return t('reconciliation.issueTypes.missingCreditTrackingEntry', { defaultValue: 'Credit not recorded' });
    case 'inconsistent_credit_remaining_amount':
      return t('reconciliation.issueTypes.inconsistentCreditRemainingAmount', { defaultValue: 'Remaining amount doesn\'t match' });
    case 'balance_discrepancy':
      return t('reconciliation.issueTypes.balanceDiscrepancy', { defaultValue: 'Balance doesn\'t match' });
    default:
      return t('reconciliation.issueTypes.unknownIssue', { defaultValue: 'Unknown issue' });
  }
}

export function getStatusBadge(t: TFunction, status: ReconciliationStatus): ReactNode {
  if (status === 'resolved') {
    return (
      <Badge className="bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-900))]">
        {t('status.resolved', { defaultValue: 'Resolved' })}
      </Badge>
    );
  }
  return (
    <Badge className="bg-[rgb(var(--color-accent-100))] text-[rgb(var(--color-accent-900))]">
      {t('status.open', { defaultValue: 'Open' })}
    </Badge>
  );
}
