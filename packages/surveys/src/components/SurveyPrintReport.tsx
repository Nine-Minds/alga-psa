'use client';

import type {
  SurveyDashboardData,
  SurveyDistributionBucket,
  SurveyIssueSummary,
  SurveyResponseListItem,
  SurveyTrendPoint,
} from '@alga-psa/types';
import { PrintableDetailHeader } from '@alga-psa/ui/components/PrintableDetailHeader';
import { PrintableSummary } from '@alga-psa/ui/components/PrintableSummary';
import { PrintableTable, type PrintableTableColumn } from '@alga-psa/ui/components/PrintableTable';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export type SurveyPrintSection = 'trend' | 'distribution' | 'topIssues' | 'recentResponses';

type SurveyPrintReportProps = {
  data: SurveyDashboardData;
  title: string;
  subtitle?: string;
  sections: SurveyPrintSection[];
};

/**
 * Print region for the survey report surfaces. The dashboard/analytics pages are
 * server components, so the column renderers have to live behind this client
 * boundary rather than being passed down as props.
 */
export default function SurveyPrintReport({ data, title, subtitle, sections }: SurveyPrintReportProps) {
  const { t } = useTranslation('msp/surveys');

  const dash = t('print.emptyValue', { defaultValue: '—' });
  const formatRating = (value: number | null): string => (value === null ? dash : value.toFixed(2));
  const formatDate = (value: string): string => new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' });

  const trendColumns: PrintableTableColumn<SurveyTrendPoint>[] = [
    { key: 'date', header: t('print.columns.date', { defaultValue: 'Date' }), render: (row) => formatDate(row.date) },
    { key: 'averageRating', header: t('print.columns.averageRating', { defaultValue: 'Average Rating' }), render: (row) => formatRating(row.averageRating) },
    { key: 'responseCount', header: t('print.columns.responses', { defaultValue: 'Responses' }), render: (row) => row.responseCount },
  ];

  const distributionColumns: PrintableTableColumn<SurveyDistributionBucket>[] = [
    { key: 'rating', header: t('print.columns.rating', { defaultValue: 'Rating' }), render: (row) => row.rating },
    { key: 'count', header: t('print.columns.responses', { defaultValue: 'Responses' }), render: (row) => row.count },
    { key: 'percentage', header: t('print.columns.share', { defaultValue: 'Share' }), render: (row) => `${row.percentage.toFixed(1)}%` },
  ];

  const issueColumns: PrintableTableColumn<SurveyIssueSummary>[] = [
    { key: 'ticket', header: t('print.columns.ticket', { defaultValue: 'Ticket' }), render: (row) => row.ticketNumber || dash },
    { key: 'client', header: t('print.columns.client', { defaultValue: 'Client' }), render: (row) => row.clientName || dash },
    { key: 'rating', header: t('print.columns.rating', { defaultValue: 'Rating' }), render: (row) => row.rating },
    { key: 'agent', header: t('print.columns.agent', { defaultValue: 'Agent' }), render: (row) => row.assignedAgentName || dash },
    { key: 'submitted', header: t('print.columns.submitted', { defaultValue: 'Submitted' }), render: (row) => formatDate(row.submittedAt) },
    { key: 'comment', header: t('print.columns.comment', { defaultValue: 'Comment' }), render: (row) => row.comment || dash },
  ];

  const responseColumns: PrintableTableColumn<SurveyResponseListItem>[] = [
    { key: 'ticket', header: t('print.columns.ticket', { defaultValue: 'Ticket' }), render: (row) => row.ticketNumber || dash },
    { key: 'client', header: t('print.columns.client', { defaultValue: 'Client' }), render: (row) => row.clientName || dash },
    { key: 'contact', header: t('print.columns.contact', { defaultValue: 'Contact' }), render: (row) => row.contactName || dash },
    { key: 'rating', header: t('print.columns.rating', { defaultValue: 'Rating' }), render: (row) => row.rating },
    { key: 'technician', header: t('print.columns.technician', { defaultValue: 'Technician' }), render: (row) => row.technicianName || dash },
    { key: 'submitted', header: t('print.columns.submitted', { defaultValue: 'Submitted' }), render: (row) => formatDate(row.submittedAt) },
    { key: 'comment', header: t('print.columns.comment', { defaultValue: 'Comment' }), render: (row) => row.comment || dash },
  ];

  const includes = (section: SurveyPrintSection): boolean => sections.includes(section);

  return (
    <div className="app-print-root app-print-only" id="survey-print-region">
      <PrintableDetailHeader title={title} subtitle={subtitle} />

      <PrintableSummary
        metrics={[
          { label: t('print.metrics.invitations', { defaultValue: 'Invitations' }), value: data.metrics.totalInvitations },
          { label: t('print.metrics.responses', { defaultValue: 'Responses' }), value: data.metrics.totalResponses },
          { label: t('print.metrics.responseRate', { defaultValue: 'Response Rate' }), value: `${data.metrics.responseRate.toFixed(1)}%` },
          { label: t('print.metrics.averageRating', { defaultValue: 'Average Rating' }), value: formatRating(data.metrics.averageRating) },
          { label: t('print.metrics.outstanding', { defaultValue: 'Outstanding' }), value: data.metrics.outstandingInvitations },
          { label: t('print.metrics.recentNegative', { defaultValue: 'Recent Negative' }), value: data.metrics.recentNegativeResponses },
        ]}
      />

      {includes('trend') && (
        <PrintableTable
          title={t('print.sections.trend', { defaultValue: 'Response Trend' })}
          rows={data.trend}
          columns={trendColumns}
          getRowKey={(row) => row.date}
          emptyMessage={t('print.empty.trend', { defaultValue: 'No responses in this period.' })}
        />
      )}

      {includes('distribution') && (
        <PrintableTable
          title={t('print.sections.distribution', { defaultValue: 'Satisfaction Distribution' })}
          rows={data.distribution}
          columns={distributionColumns}
          getRowKey={(row) => String(row.rating)}
          emptyMessage={t('print.empty.distribution', { defaultValue: 'No rated responses in this period.' })}
        />
      )}

      {includes('topIssues') && (
        <PrintableTable
          title={t('print.sections.topIssues', { defaultValue: 'Top Issues' })}
          rows={data.topIssues}
          columns={issueColumns}
          getRowKey={(row) => row.responseId}
          emptyMessage={t('print.empty.topIssues', { defaultValue: 'No negative responses in this period.' })}
        />
      )}

      {includes('recentResponses') && (
        <PrintableTable
          title={t('print.sections.recentResponses', { defaultValue: 'Recent Responses' })}
          rows={data.recentResponses}
          columns={responseColumns}
          getRowKey={(row) => row.responseId}
          emptyMessage={t('print.empty.recentResponses', { defaultValue: 'No responses in this period.' })}
        />
      )}
    </div>
  );
}
