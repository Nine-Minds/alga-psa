import Link from 'next/link';
import { MessageCircle } from 'lucide-react';

import type { SurveyResponseListItem } from 'server/src/interfaces/survey.interface';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'server/src/components/ui/Table';

type ResponsesListProps = {
  responses: SurveyResponseListItem[];
};

export default function ResponsesList({ responses }: ResponsesListProps) {
  return (
    <Card className="border-border-200 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-semibold text-text-900">Recent Responses</CardTitle>
        <div className="rounded-lg bg-primary-50 p-2 shadow-sm">
          <MessageCircle className="h-4 w-4 text-primary-500" />
        </div>
      </CardHeader>
      <CardContent className="mt-2">
        {responses.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-lg bg-gradient-to-br from-primary-50/30 to-transparent p-6">
            <div className="rounded-full bg-primary-100 p-3">
              <MessageCircle className="h-6 w-6 text-primary-500" />
            </div>
            <p className="text-center text-sm font-medium text-text-600">
              No survey responses available yet.
            </p>
            <p className="text-center text-xs text-text-500">
              Encourage customers to provide feedback to populate this view.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Submitted</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Technician</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Comment</TableHead>
                  <TableHead className="text-right">Ticket</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {responses.map((response) => (
                  <TableRow key={response.responseId}>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(response.submittedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm font-medium text-gray-900">
                      {response.clientName ?? 'Unknown Client'}
                      {response.contactName && (
                        <span className="block text-xs text-muted-foreground">
                          {response.contactName}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {response.technicianName ?? 'Unassigned'}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-600">
                        {response.rating} ★
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[240px]">
                      {response.comment ? (
                        <span className="text-sm text-gray-700 line-clamp-2">{response.comment}</span>
                      ) : (
                        <span className="text-sm italic text-muted-foreground">No comment</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      <Link
                        href={`/msp/tickets/${response.ticketId}`}
                        className="text-primary-600 hover:text-primary-700 hover:underline"
                      >
                        {response.ticketNumber ?? response.ticketId.slice(0, 7)}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
