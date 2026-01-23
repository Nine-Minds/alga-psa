import { MessageCircleWarning } from 'lucide-react';

import type { SurveyIssueSummary } from '@alga-psa/types';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';

type TopIssuesPanelProps = {
  issues: SurveyIssueSummary[];
};

export default function TopIssuesPanel({ issues }: TopIssuesPanelProps) {
  return (
    <Card className="col-span-1 flex flex-col border-border-200 shadow-sm hover:shadow-md transition-shadow duration-200">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-semibold text-text-900">Top Issues</CardTitle>
        <div className="rounded-lg bg-rose-50 p-2 shadow-sm">
          <MessageCircleWarning className="h-4 w-4 text-rose-500" />
        </div>
      </CardHeader>
      <CardContent className="mt-2 flex-1">
        {issues.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-lg bg-gradient-to-br from-rose-50/30 to-transparent p-6">
            <div className="rounded-full bg-rose-100 p-3">
              <MessageCircleWarning className="h-6 w-6 text-rose-500" />
            </div>
            <p className="text-center text-sm font-medium text-text-600">
              No negative feedback recorded for the selected filters.
            </p>
            <p className="text-center text-xs text-text-500">
              This is a good sign! Keep up the great work.
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {issues.map((issue) => (
              <li
                key={issue.responseId}
                className="rounded-lg border border-border-200 bg-gradient-to-br from-rose-50/20 to-transparent p-4 transition-all duration-200 hover:shadow-md hover:border-rose-200"
              >
                <div className="flex items-center justify-between text-sm">
                  <div className="font-medium text-gray-900">{issue.clientName ?? 'Unknown Client'}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(issue.submittedAt).toLocaleString()}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-600">
                    {issue.rating} ★
                  </span>
                  <span className="text-muted-foreground">
                    Ticket {issue.ticketNumber ?? issue.ticketId.slice(0, 7)}
                  </span>
                </div>
                {issue.comment ? (
                  <p className="mt-3 text-sm text-gray-700 line-clamp-3">{issue.comment}</p>
                ) : (
                  <p className="mt-3 text-sm italic text-muted-foreground">No comment left.</p>
                )}
                {issue.assignedAgentName && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Assigned to: {issue.assignedAgentName}
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
