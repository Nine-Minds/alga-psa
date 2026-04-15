'use client';

import { MessageCircleWarning } from 'lucide-react';

import type { SurveyIssueSummary } from '@alga-psa/types';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

type TopIssuesPanelProps = {
  issues: SurveyIssueSummary[];
};

export default function TopIssuesPanel({ issues }: TopIssuesPanelProps) {
  const { t } = useTranslation('msp/surveys');
  const { formatDate } = useFormatters();

  return (
    <Card className="col-span-1 flex flex-col border-border-200 shadow-sm transition-all duration-200 hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-semibold text-text-900">
          {t('dashboard.topIssues.title', { defaultValue: 'Top Issues' })}
        </CardTitle>
        <div className="rounded-lg bg-destructive/10 p-2 shadow-sm">
          <MessageCircleWarning className="h-4 w-4 text-rose-500 dark:text-rose-400" />
        </div>
      </CardHeader>
      <CardContent className="mt-2 flex-1">
        {issues.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-lg bg-gradient-to-br from-destructive/5 to-transparent p-6">
            <div className="rounded-full bg-destructive/15 p-3">
              <MessageCircleWarning className="h-6 w-6 text-rose-500" />
            </div>
            <p className="text-center text-sm font-medium text-text-600">
              {t('dashboard.topIssues.emptyTitle', {
                defaultValue: 'No negative feedback recorded for the selected filters.',
              })}
            </p>
            <p className="text-center text-xs text-text-500">
              {t('dashboard.topIssues.emptyDescription', {
                defaultValue: 'This is a good sign! Keep up the great work.',
              })}
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {issues.map((issue) => (
              <li
                key={issue.responseId}
                className="rounded-lg border border-border-200 bg-gradient-to-br from-destructive/5 to-transparent p-4 transition-all duration-200 hover:border-destructive/30 hover:shadow-md"
              >
                <div className="flex items-center justify-between text-sm">
                  <div className="font-medium text-[rgb(var(--color-text-900))]">
                    {issue.clientName ??
                      t('dashboard.topIssues.fallbacks.unknownClient', {
                        defaultValue: 'Unknown Client',
                      })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(issue.submittedAt, { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-1 text-xs font-semibold text-rose-600 dark:text-rose-400">
                    {issue.rating} ★
                  </span>
                  <span className="text-muted-foreground">
                    {t('dashboard.topIssues.fallbacks.ticket', {
                      defaultValue: 'Ticket {{ticket}}',
                      ticket: issue.ticketNumber ?? issue.ticketId.slice(0, 7),
                    })}
                  </span>
                </div>
                {issue.comment ? (
                  <p className="mt-3 line-clamp-3 text-sm text-[rgb(var(--color-text-700))]">{issue.comment}</p>
                ) : (
                  <p className="mt-3 text-sm italic text-muted-foreground">
                    {t('dashboard.topIssues.fallbacks.noComment', {
                      defaultValue: 'No comment left.',
                    })}
                  </p>
                )}
                {issue.assignedAgentName && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t('dashboard.topIssues.fallbacks.assignedTo', {
                      defaultValue: 'Assigned to: {{name}}',
                      name: issue.assignedAgentName,
                    })}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
