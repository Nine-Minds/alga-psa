import { MessageCircleWarning } from 'lucide-react';

import type { SurveyIssueSummary } from 'server/src/interfaces/survey.interface';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';

type TopIssuesPanelProps = {
  issues: SurveyIssueSummary[];
};

export default function TopIssuesPanel({ issues }: TopIssuesPanelProps) {
  return (
    <Card className="col-span-1 flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-semibold">Top Issues</CardTitle>
        <MessageCircleWarning className="h-4 w-4 text-rose-500" />
      </CardHeader>
      <CardContent className="mt-2 flex-1">
        {issues.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            No negative feedback recorded for the selected filters.
          </div>
        ) : (
          <ul className="space-y-4">
            {issues.map((issue) => (
              <li
                key={issue.responseId}
                className="rounded-lg border border-muted-200 bg-muted-50 p-4"
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
