'use client';

import Link from 'next/link';
import { MessageCircle } from 'lucide-react';

import type { SurveyResponseListItem } from '@alga-psa/types';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

type ResponsesListProps = {
  responses: SurveyResponseListItem[];
};

export default function ResponsesList({ responses }: ResponsesListProps) {
  const { t } = useTranslation('msp/surveys');
  const { formatDate } = useFormatters();

  return (
    <Card className="border-border-200 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-semibold text-text-900">
          {t('dashboard.responsesList.title', { defaultValue: 'Recent Responses' })}
        </CardTitle>
        <div className="rounded-lg bg-primary-500/10 p-2 shadow-sm">
          <MessageCircle className="h-4 w-4 text-primary-500" />
        </div>
      </CardHeader>
      <CardContent className="mt-2">
        {responses.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-lg bg-gradient-to-br from-primary-500/5 to-transparent p-6">
            <div className="rounded-full bg-primary-500/15 p-3">
              <MessageCircle className="h-6 w-6 text-primary-500" />
            </div>
            <p className="text-center text-sm font-medium text-text-600">
              {t('dashboard.responsesList.emptyTitle', {
                defaultValue: 'No survey responses available yet.',
              })}
            </p>
            <p className="text-center text-xs text-text-500">
              {t('dashboard.responsesList.emptyDescription', {
                defaultValue: 'Encourage customers to provide feedback to populate this view.',
              })}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">
                    {t('dashboard.responsesList.table.submitted', { defaultValue: 'Submitted' })}
                  </TableHead>
                  <TableHead>{t('dashboard.responsesList.table.client', { defaultValue: 'Client' })}</TableHead>
                  <TableHead>{t('dashboard.responsesList.table.technician', { defaultValue: 'Technician' })}</TableHead>
                  <TableHead>{t('dashboard.responsesList.table.rating', { defaultValue: 'Rating' })}</TableHead>
                  <TableHead>{t('dashboard.responsesList.table.comment', { defaultValue: 'Comment' })}</TableHead>
                  <TableHead className="text-right">
                    {t('dashboard.responsesList.table.ticket', { defaultValue: 'Ticket' })}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {responses.map((response) => (
                  <TableRow key={response.responseId}>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(response.submittedAt, { dateStyle: 'medium', timeStyle: 'short' })}
                    </TableCell>
                    <TableCell className="text-sm font-medium text-[rgb(var(--color-text-900))]">
                      {response.clientName ??
                        t('dashboard.responsesList.fallbacks.unknownClient', {
                          defaultValue: 'Unknown Client',
                        })}
                      {response.contactName && (
                        <span className="block text-xs text-muted-foreground">
                          {response.contactName}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {response.technicianName ??
                        t('dashboard.responsesList.fallbacks.unassigned', {
                          defaultValue: 'Unassigned',
                        })}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        {response.rating} ★
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[240px]">
                      {response.comment ? (
                        <span className="line-clamp-2 text-sm text-[rgb(var(--color-text-700))]">{response.comment}</span>
                      ) : (
                        <span className="text-sm italic text-muted-foreground">
                          {t('dashboard.responsesList.fallbacks.noComment', {
                            defaultValue: 'No comment',
                          })}
                        </span>
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
