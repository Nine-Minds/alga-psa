'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { EntraSyncRunUserIssue } from '@alga-psa/integrations/actions';

interface EntraSyncUserIssueListProps {
  /** True number of contacts that failed; the persisted list may hold fewer. */
  failed: number;
  issues: EntraSyncRunUserIssue[];
  /** Prefix for element ids, so a page with several clients keeps them unique. */
  idPrefix: string;
}

/**
 * Who failed to sync for one client, and why, followed by the field notes
 * (values that were changed or left out on contacts that did sync).
 *
 * "3 contacts failed" on its own sends the operator to the logs; the names and
 * reasons are what let them fix the contact and sync again.
 */
export function EntraSyncUserIssueList({
  failed,
  issues,
  idPrefix,
}: EntraSyncUserIssueListProps): React.JSX.Element | null {
  const { t } = useTranslation('msp/integrations');
  const failures = issues.filter((issue) => issue.severity === 'failure');
  const notices = issues.filter((issue) => issue.severity === 'notice');

  if (failed <= 0 && notices.length === 0) {
    return null;
  }

  const renderList = (entries: EntraSyncRunUserIssue[], kind: 'failures' | 'notices') => (
    <ul id={`${idPrefix}-${kind}`} className="list-disc space-y-0.5 pl-4">
      {entries.map((issue, index) => (
        <li key={`${issue.entraObjectId}-${issue.stage}-${index}`}>
          {t('integrations.entra.syncHistory.details.failureEntry', {
            user:
              issue.displayName
              || issue.userPrincipalName
              || t('integrations.entra.syncHistory.details.userUnknown'),
            stage: t(`integrations.entra.syncHistory.details.stages.${issue.stage}`),
            message: issue.message,
          })}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="whitespace-normal text-xs">
      {failed > 0 ? (
        <div className="mt-0.5 text-destructive">
          <p className="font-medium">
            {t('integrations.entra.syncHistory.details.contactsFailed', { count: failed })}
          </p>
          {failures.length > 0 ? renderList(failures, 'failures') : null}
          {failed > failures.length ? (
            <p>
              {t('integrations.entra.syncHistory.details.moreFailures', {
                count: failed - failures.length,
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      {notices.length > 0 ? (
        <div className="mt-1 text-muted-foreground">
          <p className="font-medium">{t('integrations.entra.syncHistory.details.noticeHeading')}</p>
          {renderList(notices, 'notices')}
        </div>
      ) : null}
    </div>
  );
}
