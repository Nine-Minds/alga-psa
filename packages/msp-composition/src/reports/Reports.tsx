'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  BarChart3,
  Clock3,
  FileBarChart,
  Ghost,
  Lock,
  type LucideIcon,
  Mail,
  Package,
  Percent,
  Timer,
  Users,
} from 'lucide-react';
import {
  type ProductCode,
  type TenantTier,
  TIER_LABELS,
  tierAtLeast,
} from '@alga-psa/types';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { PrintButton } from '@alga-psa/ui/components/PrintButton';
import { PrintableTable, type PrintableTableColumn } from '@alga-psa/ui/components/PrintableTable';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getEmailChannelHealthReport,
  getTeamPerformanceReport,
  getTicketAgingReport,
  getTicketWorkloadReport,
  getTimeUtilizationReport,
  type EmailChannelHealthReport,
  type ReportBucket,
  type ReportRangeDays,
  type TeamPerformanceReport,
  type TicketAgingReport,
  type TicketWorkloadReport,
  type TimeUtilizationReport,
} from '@alga-psa/reporting/actions/helpdeskReportActions';

type ReportCategory = 'helpdesk' | 'operations' | 'billing' | 'inventory';
type ReportKind = 'embedded' | 'link' | 'planned';
type EmbeddedReportId = 'ticket-workload' | 'ticket-aging' | 'email-channel-health' | 'time-utilization' | 'team-performance';
type LinkReportId = 'contract-reports' | 'inventory-margin' | 'inventory-write-offs' | 'inventory-ghost-usage';

interface ReportDefinition {
  id: EmbeddedReportId | LinkReportId;
  titleKey: string;
  titleDefault: string;
  descriptionKey: string;
  descriptionDefault: string;
  category: ReportCategory;
  products: ProductCode[];
  minimumTier: TenantTier;
  kind: ReportKind;
  href?: string;
  /** Label for a 'link' report's open button; defaults to the billing label. */
  openLabelKey?: string;
  openLabelDefault?: string;
  icon: LucideIcon;
}

interface ReportsProps {
  productCode?: ProductCode;
  tier?: TenantTier;
}

const isReportActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

const REPORTS: ReportDefinition[] = [
  {
    id: 'ticket-workload',
    titleKey: 'reportsPage.reportCatalog.ticketWorkload.title',
    titleDefault: 'Ticket Workload',
    descriptionKey: 'reportsPage.reportCatalog.ticketWorkload.description',
    descriptionDefault: 'Created, closed, and currently open tickets grouped by status, priority, and assignee.',
    category: 'helpdesk',
    products: ['psa', 'algadesk'],
    minimumTier: 'solo',
    kind: 'embedded',
    icon: BarChart3,
  },
  {
    id: 'ticket-aging',
    titleKey: 'reportsPage.reportCatalog.ticketAging.title',
    titleDefault: 'Ticket Aging',
    descriptionKey: 'reportsPage.reportCatalog.ticketAging.description',
    descriptionDefault: 'Open-ticket age buckets, response ownership, and oldest active tickets.',
    category: 'helpdesk',
    products: ['psa', 'algadesk'],
    minimumTier: 'solo',
    kind: 'embedded',
    icon: Timer,
  },
  {
    id: 'email-channel-health',
    titleKey: 'reportsPage.reportCatalog.emailChannelHealth.title',
    titleDefault: 'Email Channel Health',
    descriptionKey: 'reportsPage.reportCatalog.emailChannelHealth.description',
    descriptionDefault: 'Email intake volume, ticket creation speed, and mailbox connection health.',
    category: 'helpdesk',
    products: ['psa', 'algadesk'],
    minimumTier: 'solo',
    kind: 'embedded',
    icon: Mail,
  },
  {
    id: 'time-utilization',
    titleKey: 'reportsPage.reportCatalog.timeUtilization.title',
    titleDefault: 'Time Utilization',
    descriptionKey: 'reportsPage.reportCatalog.timeUtilization.description',
    descriptionDefault: 'Tracked work by person and service area for PSA operations.',
    category: 'operations',
    products: ['psa'],
    minimumTier: 'solo',
    kind: 'embedded',
    icon: Clock3,
  },
  {
    id: 'team-performance',
    titleKey: 'reportsPage.reportCatalog.teamPerformance.title',
    titleDefault: 'Team Performance',
    descriptionKey: 'reportsPage.reportCatalog.teamPerformance.description',
    descriptionDefault: 'Team-level throughput and response ownership for multi-user workspaces.',
    category: 'operations',
    products: ['psa'],
    minimumTier: 'pro',
    kind: 'embedded',
    icon: Users,
  },
  {
    id: 'contract-reports',
    titleKey: 'reportsPage.reportCatalog.contractReports.title',
    titleDefault: 'Contract Reports',
    descriptionKey: 'reportsPage.reportCatalog.contractReports.description',
    descriptionDefault: 'Contract revenue, renewals, bucket utilization, and profitability.',
    category: 'billing',
    products: ['psa'],
    minimumTier: 'pro',
    kind: 'link',
    href: '/msp/billing?tab=reports',
    icon: FileBarChart,
  },
  {
    id: 'inventory-margin',
    titleKey: 'reportsPage.reportCatalog.inventoryMargin.title',
    titleDefault: 'Margin Report',
    descriptionKey: 'reportsPage.reportCatalog.inventoryMargin.description',
    descriptionDefault: 'Per-product revenue, cost of goods sold, and margin from fulfilled sales orders.',
    category: 'inventory',
    products: ['psa'],
    minimumTier: 'solo',
    kind: 'link',
    href: '/msp/inventory/margin',
    openLabelKey: 'reportsPage.actions.openReport',
    openLabelDefault: 'Open report',
    icon: Percent,
  },
  {
    id: 'inventory-write-offs',
    titleKey: 'reportsPage.reportCatalog.inventoryWriteOffs.title',
    titleDefault: 'Write-offs',
    descriptionKey: 'reportsPage.reportCatalog.inventoryWriteOffs.description',
    descriptionDefault: 'Inventory shrink and adjustments written off, by reason and period.',
    category: 'inventory',
    products: ['psa'],
    minimumTier: 'solo',
    kind: 'link',
    href: '/msp/inventory/write-offs',
    openLabelKey: 'reportsPage.actions.openReport',
    openLabelDefault: 'Open report',
    icon: Package,
  },
  {
    id: 'inventory-ghost-usage',
    titleKey: 'reportsPage.reportCatalog.inventoryGhostUsage.title',
    titleDefault: 'Ghost Usage',
    descriptionKey: 'reportsPage.reportCatalog.inventoryGhostUsage.description',
    descriptionDefault: 'Closed hardware tickets with no recorded parts — cost the shop may have eaten.',
    category: 'inventory',
    products: ['psa'],
    minimumTier: 'solo',
    kind: 'link',
    href: '/msp/inventory/ghost-usage',
    openLabelKey: 'reportsPage.actions.openReport',
    openLabelDefault: 'Open report',
    icon: Ghost,
  },
];

const CATEGORY_LABELS: Record<ReportCategory, { key: string; defaultValue: string }> = {
  helpdesk: { key: 'reportsPage.categories.helpdesk', defaultValue: 'Help desk' },
  operations: { key: 'reportsPage.categories.operations', defaultValue: 'Operations' },
  billing: { key: 'reportsPage.categories.billing', defaultValue: 'Billing' },
  inventory: { key: 'reportsPage.categories.inventory', defaultValue: 'Inventory' },
};

function canAccessReport(report: ReportDefinition, productCode: ProductCode, tier: TenantTier): boolean {
  return report.products.includes(productCode) && tierAtLeast(tier, report.minimumTier);
}

function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-3">
      <p className="text-xs font-medium text-[rgb(var(--color-text-500))]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[rgb(var(--color-text-900))]">{value}</p>
    </div>
  );
}

function formatDurationMinutes(value: number | null, emptyText: string): string {
  if (value === null) return emptyText;
  if (value < 1) return '<1m';
  if (value < 60) return `${Math.round(value)}m`;
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatHours(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;
}

function BucketList({ title, buckets, emptyText }: { title: string; buckets: ReportBucket[]; emptyText: string }) {
  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);

  return (
    <div className="rounded-md border border-[rgb(var(--color-border-200))] p-4">
      <h3 className="text-sm font-semibold text-[rgb(var(--color-text-900))]">{title}</h3>
      <div className="mt-3 space-y-3">
        {buckets.length === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-500))]">{emptyText}</p>
        ) : (
          buckets.map((bucket) => (
            <div key={bucket.label}>
              <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-[rgb(var(--color-text-700))]">{bucket.label}</span>
                <span className="font-medium text-[rgb(var(--color-text-900))]">{bucket.count}</span>
              </div>
              <div className="h-2 rounded-full bg-[rgb(var(--color-border-200))]">
                <div
                  className="h-2 rounded-full bg-[rgb(var(--color-primary-500))]"
                  style={{ width: `${Math.max(6, (bucket.count / max) * 100)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface PrintMetric {
  label: string;
  value: number | string;
}

function PrintHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="app-print-detail-header">
      <h1>{title}</h1>
      <p className="app-print-detail-subtitle">{subtitle}</p>
    </header>
  );
}

function PrintSummary({ metrics }: { metrics: PrintMetric[] }) {
  if (metrics.length === 0) return null;
  return (
    <section className="app-print-table-section" style={{ marginBottom: '10pt' }}>
      <table className="app-print-table" style={{ tableLayout: 'fixed' }}>
        <tbody>
          <tr>
            {metrics.map((metric) => (
              <td key={metric.label} style={{ verticalAlign: 'top' }}>
                <div style={{ fontSize: '8pt', color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {metric.label}
                </div>
                <div style={{ fontSize: '15pt', fontWeight: 700, marginTop: '2pt' }}>{metric.value}</div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function PrintBarChart({
  title,
  buckets,
  valueLabel,
  emptyText,
}: {
  title: string;
  buckets: ReportBucket[];
  valueLabel?: string;
  emptyText: string;
}) {
  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);
  return (
    <section className="app-print-table-section" style={{ marginTop: '10pt' }}>
      <header className="app-print-table-header">
        <h2>{title}</h2>
      </header>
      <table className="app-print-table" style={{ tableLayout: 'fixed' }}>
        <tbody>
          {buckets.length === 0 ? (
            <tr>
              <td colSpan={3} className="app-print-table-empty">
                {emptyText}
              </td>
            </tr>
          ) : (
            buckets.map((bucket) => {
              const pct = Math.max(2, (bucket.count / max) * 100);
              return (
                <tr key={bucket.label}>
                  <td style={{ width: '32%' }}>{bucket.label}</td>
                  <td style={{ width: '52%' }}>
                    <svg
                      width="100%"
                      height="10"
                      viewBox="0 0 100 10"
                      preserveAspectRatio="none"
                      style={{ display: 'block' }}
                    >
                      <rect x="0" y="0" width="100" height="10" fill="#e5e7eb" />
                      <rect x="0" y="0" width={pct} height="10" fill="#2563eb" />
                    </svg>
                  </td>
                  <td style={{ width: '16%', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {valueLabel ? `${bucket.count} ${valueLabel}` : bucket.count}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </section>
  );
}

function PrintReportRoot({ children }: { children: ReactNode }) {
  return <div className="app-print-root app-print-only">{children}</div>;
}

function LoadingReport() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

function TicketWorkloadView({ rangeDays }: { rangeDays: ReportRangeDays }) {
  const { t } = useTranslation('msp/reports');
  const [report, setReport] = useState<TicketWorkloadReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    getTicketWorkloadReport(rangeDays)
      .then((data) => {
        if (isReportActionError(data)) {
          if (!cancelled) setError(getErrorMessage(data));
          return;
        }
        if (!cancelled) setReport(data);
      })
      .catch((err) => {
        console.error('Failed to load ticket workload report:', err);
        if (!cancelled) setError(t('reportsPage.errors.loadReport', { defaultValue: 'Failed to load report.' }));
      });
    return () => {
      cancelled = true;
    };
  }, [rangeDays, t]);

  if (error) return <p className="text-sm text-[rgb(var(--color-destructive-600))]">{error}</p>;
  if (!report) return <LoadingReport />;

  const emptyText = t('reportsPage.empty.noData', { defaultValue: 'No data for this report.' });
  const printTitle = t('reportsPage.reportCatalog.ticketWorkload.title', { defaultValue: 'Ticket Workload' });
  const printSubtitle = t('reportsPage.dateRange.lastDays', { defaultValue: 'Last {{count}} days', count: report.rangeDays });

  return (
    <>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-5">
          <MetricCard label={t('reportsPage.metrics.created', { defaultValue: 'Created' })} value={report.summary.created} />
          <MetricCard label={t('reportsPage.metrics.closed', { defaultValue: 'Closed' })} value={report.summary.closed} />
          <MetricCard label={t('reportsPage.metrics.openNow', { defaultValue: 'Open now' })} value={report.summary.open} />
          <MetricCard label={t('reportsPage.metrics.awaitingCustomer', { defaultValue: 'Awaiting customer' })} value={report.summary.awaitingCustomer} />
          <MetricCard label={t('reportsPage.metrics.awaitingInternal', { defaultValue: 'Awaiting internal' })} value={report.summary.awaitingInternal} />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <BucketList title={t('reportsPage.sections.openByStatus', { defaultValue: 'Open by status' })} buckets={report.byStatus} emptyText={emptyText} />
          <BucketList title={t('reportsPage.sections.openByPriority', { defaultValue: 'Open by priority' })} buckets={report.byPriority} emptyText={emptyText} />
          <BucketList title={t('reportsPage.sections.openByAssignee', { defaultValue: 'Open by assignee' })} buckets={report.byAssignee} emptyText={emptyText} />
        </div>
      </div>
      <PrintReportRoot>
        <PrintHeader title={printTitle} subtitle={printSubtitle} />
        <PrintSummary
          metrics={[
            { label: t('reportsPage.metrics.created', { defaultValue: 'Created' }), value: report.summary.created },
            { label: t('reportsPage.metrics.closed', { defaultValue: 'Closed' }), value: report.summary.closed },
            { label: t('reportsPage.metrics.openNow', { defaultValue: 'Open now' }), value: report.summary.open },
            { label: t('reportsPage.metrics.awaitingCustomer', { defaultValue: 'Awaiting customer' }), value: report.summary.awaitingCustomer },
            { label: t('reportsPage.metrics.awaitingInternal', { defaultValue: 'Awaiting internal' }), value: report.summary.awaitingInternal },
          ]}
        />
        <PrintBarChart title={t('reportsPage.sections.openByStatus', { defaultValue: 'Open by status' })} buckets={report.byStatus} emptyText={emptyText} />
        <PrintBarChart title={t('reportsPage.sections.openByPriority', { defaultValue: 'Open by priority' })} buckets={report.byPriority} emptyText={emptyText} />
        <PrintBarChart title={t('reportsPage.sections.openByAssignee', { defaultValue: 'Open by assignee' })} buckets={report.byAssignee} emptyText={emptyText} />
      </PrintReportRoot>
    </>
  );
}

function TimeUtilizationView({ rangeDays }: { rangeDays: ReportRangeDays }) {
  const { t } = useTranslation('msp/reports');
  const [report, setReport] = useState<TimeUtilizationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    getTimeUtilizationReport(rangeDays)
      .then((data) => {
        if (isReportActionError(data)) {
          if (!cancelled) setError(getErrorMessage(data));
          return;
        }
        if (!cancelled) setReport(data);
      })
      .catch((err) => {
        console.error('Failed to load time utilization report:', err);
        if (!cancelled) setError(t('reportsPage.errors.loadReport', { defaultValue: 'Failed to load report.' }));
      });
    return () => {
      cancelled = true;
    };
  }, [rangeDays, t]);

  if (error) return <p className="text-sm text-[rgb(var(--color-destructive-600))]">{error}</p>;
  if (!report) return <LoadingReport />;

  const emptyText = t('reportsPage.empty.noData', { defaultValue: 'No data for this report.' });
  const serviceBuckets = report.byService.map((bucket) => ({
    ...bucket,
    label: `${bucket.label} (${formatHours(bucket.count)})`,
  }));
  const printTitle = t('reportsPage.reportCatalog.timeUtilization.title', { defaultValue: 'Time Utilization' });
  const printSubtitle = t('reportsPage.dateRange.lastDays', { defaultValue: 'Last {{count}} days', count: report.rangeDays });

  type ByUserRow = (typeof report.byUser)[number];
  const byUserColumns: PrintableTableColumn<ByUserRow>[] = [
    { key: 'name', header: t('reportsPage.table.user', { defaultValue: 'User' }), render: (row) => row.name },
    { key: 'total', header: t('reportsPage.table.totalHours', { defaultValue: 'Total hours' }), render: (row) => formatHours(row.totalHours) },
    { key: 'billable', header: t('reportsPage.table.billableHours', { defaultValue: 'Billable hours' }), render: (row) => formatHours(row.billableHours) },
    { key: 'entries', header: t('reportsPage.table.entries', { defaultValue: 'Entries' }), render: (row) => row.entries },
  ];

  return (
    <>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-5">
          <MetricCard label={t('reportsPage.metrics.totalHours', { defaultValue: 'Total hours' })} value={formatHours(report.summary.totalHours)} />
          <MetricCard label={t('reportsPage.metrics.billableHours', { defaultValue: 'Billable hours' })} value={formatHours(report.summary.billableHours)} />
          <MetricCard label={t('reportsPage.metrics.nonBillableHours', { defaultValue: 'Non-billable hours' })} value={formatHours(report.summary.nonBillableHours)} />
          <MetricCard label={t('reportsPage.metrics.billablePercent', { defaultValue: 'Billable %' })} value={`${report.summary.billablePercent}%`} />
          <MetricCard label={t('reportsPage.metrics.timeEntries', { defaultValue: 'Time entries' })} value={report.summary.entries} />
        </div>
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-md border border-[rgb(var(--color-border-200))]">
            <div className="border-b border-[rgb(var(--color-border-200))] p-4">
              <h3 className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
                {t('reportsPage.sections.timeByUser', { defaultValue: 'Time by user' })}
              </h3>
            </div>
            <div className="divide-y divide-[rgb(var(--color-border-200))]">
              {report.byUser.length === 0 ? (
                <p className="p-4 text-sm text-[rgb(var(--color-text-500))]">{emptyText}</p>
              ) : (
                report.byUser.map((user) => (
                  <div key={user.userId} className="grid gap-2 p-4 text-sm md:grid-cols-[1fr_110px_110px_80px]">
                    <span className="font-medium text-[rgb(var(--color-text-900))]">{user.name}</span>
                    <span className="text-[rgb(var(--color-text-700))]">{formatHours(user.totalHours)}</span>
                    <span className="text-[rgb(var(--color-text-700))]">{formatHours(user.billableHours)}</span>
                    <span className="text-[rgb(var(--color-text-500))]">{user.entries}</span>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="space-y-4">
            <BucketList title={t('reportsPage.sections.billableHoursByService', { defaultValue: 'Billable hours by service' })} buckets={serviceBuckets} emptyText={emptyText} />
            <BucketList title={t('reportsPage.sections.entriesByWorkType', { defaultValue: 'Entries by work type' })} buckets={report.byWorkType} emptyText={emptyText} />
          </div>
        </div>
      </div>
      <PrintReportRoot>
        <PrintHeader title={printTitle} subtitle={printSubtitle} />
        <PrintSummary
          metrics={[
            { label: t('reportsPage.metrics.totalHours', { defaultValue: 'Total hours' }), value: formatHours(report.summary.totalHours) },
            { label: t('reportsPage.metrics.billableHours', { defaultValue: 'Billable hours' }), value: formatHours(report.summary.billableHours) },
            { label: t('reportsPage.metrics.nonBillableHours', { defaultValue: 'Non-billable hours' }), value: formatHours(report.summary.nonBillableHours) },
            { label: t('reportsPage.metrics.billablePercent', { defaultValue: 'Billable %' }), value: `${report.summary.billablePercent}%` },
            { label: t('reportsPage.metrics.timeEntries', { defaultValue: 'Time entries' }), value: report.summary.entries },
          ]}
        />
        <PrintableTable
          title={t('reportsPage.sections.timeByUser', { defaultValue: 'Time by user' })}
          rows={report.byUser}
          columns={byUserColumns}
          getRowKey={(row) => row.userId}
          emptyMessage={emptyText}
        />
        <PrintBarChart title={t('reportsPage.sections.billableHoursByService', { defaultValue: 'Billable hours by service' })} buckets={report.byService} valueLabel="h" emptyText={emptyText} />
        <PrintBarChart title={t('reportsPage.sections.entriesByWorkType', { defaultValue: 'Entries by work type' })} buckets={report.byWorkType} emptyText={emptyText} />
      </PrintReportRoot>
    </>
  );
}

function formatHoursDuration(value: number | null, emptyText: string): string {
  if (value === null) return emptyText;
  return formatHours(Math.round(value * 10) / 10);
}

function TeamPerformanceView({ rangeDays }: { rangeDays: ReportRangeDays }) {
  const { t } = useTranslation('msp/reports');
  const [report, setReport] = useState<TeamPerformanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    getTeamPerformanceReport(rangeDays)
      .then((data) => {
        if (isReportActionError(data)) {
          if (!cancelled) setError(getErrorMessage(data));
          return;
        }
        if (!cancelled) setReport(data);
      })
      .catch((err) => {
        console.error('Failed to load team performance report:', err);
        if (!cancelled) setError(t('reportsPage.errors.loadReport', { defaultValue: 'Failed to load report.' }));
      });
    return () => {
      cancelled = true;
    };
  }, [rangeDays, t]);

  if (error) return <p className="text-sm text-[rgb(var(--color-destructive-600))]">{error}</p>;
  if (!report) return <LoadingReport />;

  const emptyDuration = t('reportsPage.empty.notAvailable', { defaultValue: 'n/a' });
  const emptyText = t('reportsPage.empty.noData', { defaultValue: 'No data for this report.' });
  const printTitle = t('reportsPage.reportCatalog.teamPerformance.title', { defaultValue: 'Team Performance' });
  const printSubtitle = t('reportsPage.dateRange.lastDays', { defaultValue: 'Last {{count}} days', count: report.rangeDays });

  type ByAssigneeRow = (typeof report.byAssignee)[number];
  const byAssigneeColumns: PrintableTableColumn<ByAssigneeRow>[] = [
    { key: 'name', header: t('reportsPage.table.assignee', { defaultValue: 'Assignee' }), render: (row) => row.name },
    { key: 'created', header: t('reportsPage.table.created', { defaultValue: 'Created' }), render: (row) => row.createdTickets },
    { key: 'closed', header: t('reportsPage.table.closed', { defaultValue: 'Closed' }), render: (row) => row.closedTickets },
    { key: 'open', header: t('reportsPage.table.open', { defaultValue: 'Open' }), render: (row) => row.openTickets },
    { key: 'avg', header: t('reportsPage.table.avgResolution', { defaultValue: 'Avg. resolution' }), render: (row) => formatHoursDuration(row.avgResolutionHours, emptyDuration) },
  ];

  return (
    <>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-5">
          <MetricCard label={t('reportsPage.metrics.created', { defaultValue: 'Created' })} value={report.summary.createdTickets} />
          <MetricCard label={t('reportsPage.metrics.closed', { defaultValue: 'Closed' })} value={report.summary.closedTickets} />
          <MetricCard label={t('reportsPage.metrics.openAssigned', { defaultValue: 'Open assigned' })} value={report.summary.openAssignedTickets} />
          <MetricCard label={t('reportsPage.metrics.activeAssignees', { defaultValue: 'Active assignees' })} value={report.summary.activeAssignees} />
          <MetricCard label={t('reportsPage.metrics.avgResolutionTime', { defaultValue: 'Avg. resolution time' })} value={formatHoursDuration(report.summary.avgResolutionHours, emptyDuration)} />
        </div>
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-md border border-[rgb(var(--color-border-200))]">
            <div className="border-b border-[rgb(var(--color-border-200))] p-4">
              <h3 className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
                {t('reportsPage.sections.performanceByAssignee', { defaultValue: 'Performance by assignee' })}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-[rgb(var(--color-border-200))] text-sm">
                <thead className="bg-[rgb(var(--color-background-100))]">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-[rgb(var(--color-text-600))]">{t('reportsPage.table.assignee', { defaultValue: 'Assignee' })}</th>
                    <th className="px-4 py-3 text-right font-medium text-[rgb(var(--color-text-600))]">{t('reportsPage.table.created', { defaultValue: 'Created' })}</th>
                    <th className="px-4 py-3 text-right font-medium text-[rgb(var(--color-text-600))]">{t('reportsPage.table.closed', { defaultValue: 'Closed' })}</th>
                    <th className="px-4 py-3 text-right font-medium text-[rgb(var(--color-text-600))]">{t('reportsPage.table.open', { defaultValue: 'Open' })}</th>
                    <th className="px-4 py-3 text-right font-medium text-[rgb(var(--color-text-600))]">{t('reportsPage.table.avgResolution', { defaultValue: 'Avg. resolution' })}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--color-border-200))]">
                  {report.byAssignee.length === 0 ? (
                    <tr>
                      <td className="px-4 py-5 text-[rgb(var(--color-text-500))]" colSpan={5}>
                        {emptyText}
                      </td>
                    </tr>
                  ) : (
                    report.byAssignee.map((assignee) => (
                      <tr key={assignee.userId}>
                        <td className="px-4 py-3 font-medium text-[rgb(var(--color-text-900))]">{assignee.name}</td>
                        <td className="px-4 py-3 text-right text-[rgb(var(--color-text-700))]">{assignee.createdTickets}</td>
                        <td className="px-4 py-3 text-right text-[rgb(var(--color-text-700))]">{assignee.closedTickets}</td>
                        <td className="px-4 py-3 text-right text-[rgb(var(--color-text-700))]">{assignee.openTickets}</td>
                        <td className="px-4 py-3 text-right text-[rgb(var(--color-text-700))]">{formatHoursDuration(assignee.avgResolutionHours, emptyDuration)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="space-y-4">
            <BucketList title={t('reportsPage.sections.openByAssignee', { defaultValue: 'Open by assignee' })} buckets={report.openByAssignee} emptyText={emptyText} />
            <BucketList title={t('reportsPage.sections.closedByAssignee', { defaultValue: 'Closed by assignee' })} buckets={report.closedByAssignee} emptyText={emptyText} />
          </div>
        </div>
      </div>
      <PrintReportRoot>
        <PrintHeader title={printTitle} subtitle={printSubtitle} />
        <PrintSummary
          metrics={[
            { label: t('reportsPage.metrics.created', { defaultValue: 'Created' }), value: report.summary.createdTickets },
            { label: t('reportsPage.metrics.closed', { defaultValue: 'Closed' }), value: report.summary.closedTickets },
            { label: t('reportsPage.metrics.openAssigned', { defaultValue: 'Open assigned' }), value: report.summary.openAssignedTickets },
            { label: t('reportsPage.metrics.activeAssignees', { defaultValue: 'Active assignees' }), value: report.summary.activeAssignees },
            { label: t('reportsPage.metrics.avgResolutionTime', { defaultValue: 'Avg. resolution time' }), value: formatHoursDuration(report.summary.avgResolutionHours, emptyDuration) },
          ]}
        />
        <PrintableTable
          title={t('reportsPage.sections.performanceByAssignee', { defaultValue: 'Performance by assignee' })}
          rows={report.byAssignee}
          columns={byAssigneeColumns}
          getRowKey={(row) => row.userId}
          emptyMessage={emptyText}
        />
        <PrintBarChart title={t('reportsPage.sections.openByAssignee', { defaultValue: 'Open by assignee' })} buckets={report.openByAssignee} emptyText={emptyText} />
        <PrintBarChart title={t('reportsPage.sections.closedByAssignee', { defaultValue: 'Closed by assignee' })} buckets={report.closedByAssignee} emptyText={emptyText} />
      </PrintReportRoot>
    </>
  );
}

function EmailChannelHealthView({ rangeDays }: { rangeDays: ReportRangeDays }) {
  const { t } = useTranslation('msp/reports');
  const [report, setReport] = useState<EmailChannelHealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    getEmailChannelHealthReport(rangeDays)
      .then((data) => {
        if (isReportActionError(data)) {
          if (!cancelled) setError(getErrorMessage(data));
          return;
        }
        if (!cancelled) setReport(data);
      })
      .catch((err) => {
        console.error('Failed to load email channel health report:', err);
        if (!cancelled) setError(t('reportsPage.errors.loadReport', { defaultValue: 'Failed to load report.' }));
      });
    return () => {
      cancelled = true;
    };
  }, [rangeDays, t]);

  if (error) return <p className="text-sm text-[rgb(var(--color-destructive-600))]">{error}</p>;
  if (!report) return <LoadingReport />;

  const emptyDuration = t('reportsPage.empty.notAvailable', { defaultValue: 'n/a' });
  const emptyText = t('reportsPage.empty.noData', { defaultValue: 'No data for this report.' });
  const processingStatusBuckets = report.byStatus.map((bucket) => ({
    ...bucket,
    label: t(`reportsPage.statusValues.${bucket.label}`, { defaultValue: bucket.label }),
  }));
  const printTitle = t('reportsPage.reportCatalog.emailChannelHealth.title', { defaultValue: 'Email Channel Health' });
  const printSubtitle = t('reportsPage.dateRange.lastDays', { defaultValue: 'Last {{count}} days', count: report.rangeDays });

  type ChannelRow = (typeof report.channels)[number];
  const channelColumns: PrintableTableColumn<ChannelRow>[] = [
    {
      key: 'channel',
      header: t('reportsPage.table.channel', { defaultValue: 'Channel' }),
      render: (row) => (
        <>
          <div style={{ fontWeight: 600 }}>{row.providerName}</div>
          <div style={{ fontSize: '8pt', color: '#555' }}>{row.mailbox || row.providerType}</div>
        </>
      ),
    },
    {
      key: 'status',
      header: t('reportsPage.table.status', { defaultValue: 'Status' }),
      render: (row) => t(`reportsPage.statusValues.${row.status}`, { defaultValue: row.status }),
    },
    {
      key: 'processed',
      header: t('reportsPage.table.processed', { defaultValue: 'Processed' }),
      render: (row) => row.processedEmails,
    },
    {
      key: 'tickets',
      header: t('reportsPage.table.tickets', { defaultValue: 'Tickets' }),
      render: (row) => row.ticketsCreated,
    },
    {
      key: 'avg',
      header: t('reportsPage.table.avgEmailToTicket', { defaultValue: 'Avg. email to ticket' }),
      render: (row) => formatDurationMinutes(row.avgTicketCreationMinutes, emptyDuration),
    },
  ];

  return (
    <>
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label={t('reportsPage.metrics.activeChannels', { defaultValue: 'Active channels' })} value={`${report.summary.activeChannels}/${report.summary.totalChannels}`} />
        <MetricCard label={t('reportsPage.metrics.healthyChannels', { defaultValue: 'Healthy channels' })} value={report.summary.healthyChannels} />
        <MetricCard label={t('reportsPage.metrics.problemChannels', { defaultValue: 'Problem channels' })} value={report.summary.problemChannels} />
        <MetricCard label={t('reportsPage.metrics.emailsProcessed', { defaultValue: 'Emails processed' })} value={report.summary.processedEmails} />
        <MetricCard label={t('reportsPage.metrics.ticketsFromEmail', { defaultValue: 'Tickets from email' })} value={report.summary.ticketsCreated} />
        <MetricCard label={t('reportsPage.metrics.failedEmails', { defaultValue: 'Failed emails' })} value={report.summary.failedEmails} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <MetricCard label={t('reportsPage.metrics.avgProcessingTime', { defaultValue: 'Avg. processing time' })} value={formatDurationMinutes(report.summary.avgProcessingMinutes, emptyDuration)} />
            <MetricCard label={t('reportsPage.metrics.avgTicketCreationTime', { defaultValue: 'Avg. email-to-ticket time' })} value={formatDurationMinutes(report.summary.avgTicketCreationMinutes, emptyDuration)} />
          </div>
          <BucketList title={t('reportsPage.sections.emailProcessingStatus', { defaultValue: 'Processing status' })} buckets={processingStatusBuckets} emptyText={t('reportsPage.empty.noData', { defaultValue: 'No data for this report.' })} />
        </div>
        <div className="rounded-md border border-[rgb(var(--color-border-200))]">
          <div className="border-b border-[rgb(var(--color-border-200))] p-4">
            <h3 className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
              {t('reportsPage.sections.emailChannels', { defaultValue: 'Email channels' })}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[rgb(var(--color-border-200))] text-sm">
              <thead className="bg-[rgb(var(--color-background-100))]">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-[rgb(var(--color-text-600))]">{t('reportsPage.table.channel', { defaultValue: 'Channel' })}</th>
                  <th className="px-4 py-3 text-left font-medium text-[rgb(var(--color-text-600))]">{t('reportsPage.table.status', { defaultValue: 'Status' })}</th>
                  <th className="px-4 py-3 text-right font-medium text-[rgb(var(--color-text-600))]">{t('reportsPage.table.processed', { defaultValue: 'Processed' })}</th>
                  <th className="px-4 py-3 text-right font-medium text-[rgb(var(--color-text-600))]">{t('reportsPage.table.tickets', { defaultValue: 'Tickets' })}</th>
                  <th className="px-4 py-3 text-right font-medium text-[rgb(var(--color-text-600))]">{t('reportsPage.table.avgEmailToTicket', { defaultValue: 'Avg. email to ticket' })}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgb(var(--color-border-200))]">
                {report.channels.length === 0 ? (
                  <tr>
                    <td className="px-4 py-5 text-[rgb(var(--color-text-500))]" colSpan={5}>
                      {t('reportsPage.empty.noEmailChannels', { defaultValue: 'No email channels are configured.' })}
                    </td>
                  </tr>
                ) : (
                  report.channels.map((channel) => (
                    <tr key={channel.providerId}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-[rgb(var(--color-text-900))]">{channel.providerName}</div>
                        <div className="text-xs text-[rgb(var(--color-text-500))]">{channel.mailbox || channel.providerType}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={channel.isActive && channel.status === 'connected' ? 'success' : channel.isActive ? 'warning' : 'default-muted'}>
                          {t(`reportsPage.statusValues.${channel.status}`, { defaultValue: channel.status })}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right text-[rgb(var(--color-text-700))]">{channel.processedEmails}</td>
                      <td className="px-4 py-3 text-right text-[rgb(var(--color-text-700))]">{channel.ticketsCreated}</td>
                      <td className="px-4 py-3 text-right text-[rgb(var(--color-text-700))]">
                        {formatDurationMinutes(channel.avgTicketCreationMinutes, emptyDuration)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    <PrintReportRoot>
      <PrintHeader title={printTitle} subtitle={printSubtitle} />
      <PrintSummary
        metrics={[
          { label: t('reportsPage.metrics.activeChannels', { defaultValue: 'Active channels' }), value: `${report.summary.activeChannels}/${report.summary.totalChannels}` },
          { label: t('reportsPage.metrics.healthyChannels', { defaultValue: 'Healthy channels' }), value: report.summary.healthyChannels },
          { label: t('reportsPage.metrics.problemChannels', { defaultValue: 'Problem channels' }), value: report.summary.problemChannels },
          { label: t('reportsPage.metrics.emailsProcessed', { defaultValue: 'Emails processed' }), value: report.summary.processedEmails },
          { label: t('reportsPage.metrics.ticketsFromEmail', { defaultValue: 'Tickets from email' }), value: report.summary.ticketsCreated },
          { label: t('reportsPage.metrics.failedEmails', { defaultValue: 'Failed emails' }), value: report.summary.failedEmails },
        ]}
      />
      <PrintSummary
        metrics={[
          { label: t('reportsPage.metrics.avgProcessingTime', { defaultValue: 'Avg. processing time' }), value: formatDurationMinutes(report.summary.avgProcessingMinutes, emptyDuration) },
          { label: t('reportsPage.metrics.avgTicketCreationTime', { defaultValue: 'Avg. email-to-ticket time' }), value: formatDurationMinutes(report.summary.avgTicketCreationMinutes, emptyDuration) },
        ]}
      />
      <PrintBarChart
        title={t('reportsPage.sections.emailProcessingStatus', { defaultValue: 'Processing status' })}
        buckets={processingStatusBuckets}
        emptyText={emptyText}
      />
      <PrintableTable
        title={t('reportsPage.sections.emailChannels', { defaultValue: 'Email channels' })}
        rows={report.channels}
        columns={channelColumns}
        getRowKey={(row) => row.providerId}
        emptyMessage={t('reportsPage.empty.noEmailChannels', { defaultValue: 'No email channels are configured.' })}
      />
    </PrintReportRoot>
    </>
  );
}

function TicketAgingView({ rangeDays }: { rangeDays: ReportRangeDays }) {
  const { t } = useTranslation('msp/reports');
  const [report, setReport] = useState<TicketAgingReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    getTicketAgingReport(rangeDays)
      .then((data) => {
        if (isReportActionError(data)) {
          if (!cancelled) setError(getErrorMessage(data));
          return;
        }
        if (!cancelled) setReport(data);
      })
      .catch((err) => {
        console.error('Failed to load ticket aging report:', err);
        if (!cancelled) setError(t('reportsPage.errors.loadReport', { defaultValue: 'Failed to load report.' }));
      });
    return () => {
      cancelled = true;
    };
  }, [rangeDays, t]);

  if (error) return <p className="text-sm text-[rgb(var(--color-destructive-600))]">{error}</p>;
  if (!report) return <LoadingReport />;

  const emptyText = t('reportsPage.empty.noData', { defaultValue: 'No data for this report.' });
  const printTitle = t('reportsPage.reportCatalog.ticketAging.title', { defaultValue: 'Ticket Aging' });
  const printSubtitle = t('reportsPage.dateRange.lastDays', { defaultValue: 'Last {{count}} days', count: report.rangeDays });

  type OldestTicket = (typeof report.oldestOpenTickets)[number];
  const oldestColumns: PrintableTableColumn<OldestTicket>[] = [
    {
      key: 'ticket',
      header: t('reportsPage.table.ticket', { defaultValue: 'Ticket' }),
      render: (row) => (
        <>
          <div style={{ fontWeight: 600 }}>{row.ticketNumber}: {row.title}</div>
          <div style={{ fontSize: '8pt', color: '#555' }}>{row.clientName}</div>
        </>
      ),
    },
    {
      key: 'entered',
      header: t('reportsPage.table.entered', { defaultValue: 'Entered' }),
      render: (row) => row.enteredAt ? new Date(row.enteredAt).toLocaleDateString() : t('reportsPage.empty.noDate', { defaultValue: 'No date' }),
    },
    {
      key: 'age',
      header: t('reportsPage.table.age', { defaultValue: 'Age' }),
      render: (row) => t('reportsPage.units.daysWithCount', { defaultValue: '{{count}} days', count: row.ageDays }),
    },
  ];

  return (
    <>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-5">
          <MetricCard label={t('reportsPage.metrics.openNow', { defaultValue: 'Open now' })} value={report.summary.open} />
          <MetricCard label={t('reportsPage.metrics.under2Days', { defaultValue: 'Under 2 days' })} value={report.summary.under2Days} />
          <MetricCard label={t('reportsPage.metrics.days2To7', { defaultValue: '2 to 7 days' })} value={report.summary.days2To7} />
          <MetricCard label={t('reportsPage.metrics.days8To30', { defaultValue: '8 to 30 days' })} value={report.summary.days8To30} />
          <MetricCard label={t('reportsPage.metrics.over30Days', { defaultValue: 'Over 30 days' })} value={report.summary.over30Days} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <BucketList title={t('reportsPage.sections.ageDistribution', { defaultValue: 'Age distribution' })} buckets={report.byAge} emptyText={emptyText} />
          <BucketList title={t('reportsPage.sections.responseOwnership', { defaultValue: 'Response ownership' })} buckets={report.byResponseState} emptyText={emptyText} />
        </div>
        <div className="rounded-md border border-[rgb(var(--color-border-200))]">
          <div className="border-b border-[rgb(var(--color-border-200))] p-4">
            <h3 className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
              {t('reportsPage.sections.oldestOpenTickets', { defaultValue: 'Oldest open tickets' })}
            </h3>
          </div>
          <div className="divide-y divide-[rgb(var(--color-border-200))]">
            {report.oldestOpenTickets.length === 0 ? (
              <p className="p-4 text-sm text-[rgb(var(--color-text-500))]">
                {t('reportsPage.empty.noOpenTicketsInRange', { defaultValue: 'No open tickets in this range.' })}
              </p>
            ) : (
              report.oldestOpenTickets.map((ticket) => (
                <div key={ticket.ticketId} className="grid gap-2 p-4 text-sm md:grid-cols-[1fr_160px_90px]">
                  <div>
                    <Link className="font-medium text-[rgb(var(--color-primary-600))] hover:underline" href={`/msp/tickets/${ticket.ticketId}`}>
                      {ticket.ticketNumber}: {ticket.title}
                    </Link>
                    <p className="mt-1 text-[rgb(var(--color-text-500))]">{ticket.clientName}</p>
                  </div>
                  <span className="text-[rgb(var(--color-text-600))]">
                    {ticket.enteredAt ? new Date(ticket.enteredAt).toLocaleDateString() : t('reportsPage.empty.noDate', { defaultValue: 'No date' })}
                  </span>
                  <span className="font-medium text-[rgb(var(--color-text-900))]">
                    {t('reportsPage.units.daysWithCount', { defaultValue: '{{count}} days', count: ticket.ageDays })}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <PrintReportRoot>
        <PrintHeader title={printTitle} subtitle={printSubtitle} />
        <PrintSummary
          metrics={[
            { label: t('reportsPage.metrics.openNow', { defaultValue: 'Open now' }), value: report.summary.open },
            { label: t('reportsPage.metrics.under2Days', { defaultValue: 'Under 2 days' }), value: report.summary.under2Days },
            { label: t('reportsPage.metrics.days2To7', { defaultValue: '2 to 7 days' }), value: report.summary.days2To7 },
            { label: t('reportsPage.metrics.days8To30', { defaultValue: '8 to 30 days' }), value: report.summary.days8To30 },
            { label: t('reportsPage.metrics.over30Days', { defaultValue: 'Over 30 days' }), value: report.summary.over30Days },
          ]}
        />
        <PrintBarChart title={t('reportsPage.sections.ageDistribution', { defaultValue: 'Age distribution' })} buckets={report.byAge} emptyText={emptyText} />
        <PrintBarChart title={t('reportsPage.sections.responseOwnership', { defaultValue: 'Response ownership' })} buckets={report.byResponseState} emptyText={emptyText} />
        <PrintableTable
          title={t('reportsPage.sections.oldestOpenTickets', { defaultValue: 'Oldest open tickets' })}
          rows={report.oldestOpenTickets}
          columns={oldestColumns}
          getRowKey={(row) => row.ticketId}
          emptyMessage={t('reportsPage.empty.noOpenTicketsInRange', { defaultValue: 'No open tickets in this range.' })}
        />
      </PrintReportRoot>
    </>
  );
}

export default function Reports({ productCode = 'psa', tier = 'pro' }: ReportsProps) {
  const { t } = useTranslation('msp/reports');
  const [selectedReportId, setSelectedReportId] = useState<EmbeddedReportId>('ticket-workload');
  const [rangeDays, setRangeDays] = useState<ReportRangeDays>(30);

  const visibleReports = useMemo(
    () => REPORTS.filter((report) => report.products.includes(productCode)),
    [productCode],
  );

  const selectedReport = visibleReports.find((report) => report.id === selectedReportId);

  return (
    <div className="min-h-screen bg-[rgb(var(--color-background-50))] p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[rgb(var(--color-text-900))]">
              {t('page.title', { defaultValue: 'Reports' })}
            </h1>
            <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
              {t('reportsPage.description', {
                defaultValue: 'Canned operational reports for the current workspace. More customization will layer onto this catalog later.',
              })}
            </p>
          </div>
          <div className="flex gap-2">
            {[7, 30, 90].map((days) => (
              <Button
                key={days}
                id={`reports-range-${days}`}
                variant={rangeDays === days ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRangeDays(days as ReportRangeDays)}
              >
                {days}d
              </Button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {visibleReports.map((report) => {
            const Icon = report.icon;
            const hasAccess = canAccessReport(report, productCode, tier);
            const isSelected = selectedReportId === report.id;

            return (
              <Card
                key={report.id}
                className={`border ${isSelected ? 'border-[rgb(var(--color-primary-400))]' : 'border-[rgb(var(--color-border-200))]'}`}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-700))]">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base">
                          {t(report.titleKey, { defaultValue: report.titleDefault })}
                        </CardTitle>
                        <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">
                          {t(CATEGORY_LABELS[report.category].key, { defaultValue: CATEGORY_LABELS[report.category].defaultValue })}
                        </p>
                      </div>
                    </div>
                    {!hasAccess ? (
                      <Badge variant="warning" className="gap-1">
                        <Lock className="h-3 w-3" />
                        {TIER_LABELS[report.minimumTier]}
                      </Badge>
                    ) : report.kind === 'planned' ? (
                      <Badge variant="default-muted">
                        {t('reportsPage.badges.planned', { defaultValue: 'Planned' })}
                      </Badge>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="min-h-12 text-sm text-[rgb(var(--color-text-600))]">
                    {t(report.descriptionKey, { defaultValue: report.descriptionDefault })}
                  </p>
                  {report.kind === 'embedded' ? (
                    <Button
                      id={`reports-view-${report.id}`}
                      variant={isSelected ? 'default' : 'outline'}
                      size="sm"
                      disabled={!hasAccess}
                      onClick={() => setSelectedReportId(report.id as EmbeddedReportId)}
                    >
                      {t('reportsPage.actions.viewReport', { defaultValue: 'View report' })}
                    </Button>
                  ) : report.kind === 'link' && report.href ? (
                    hasAccess ? (
                      <Button id={`reports-open-${report.id}`} asChild size="sm" variant="outline">
                        <Link href={report.href}>
                          {t(report.openLabelKey ?? 'reportsPage.actions.openInBilling', {
                            defaultValue: report.openLabelDefault ?? 'Open in billing',
                          })}
                        </Link>
                      </Button>
                    ) : (
                      <Button id={`reports-locked-${report.id}`} size="sm" variant="outline" disabled>
                        {t('reportsPage.actions.requiresTier', {
                          defaultValue: 'Requires {{tier}}',
                          tier: TIER_LABELS[report.minimumTier],
                        })}
                      </Button>
                    )
                  ) : (
                    <Button id={`reports-planned-${report.id}`} size="sm" variant="outline" disabled>
                      {t('reportsPage.actions.comingSoon', { defaultValue: 'Coming soon' })}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <Activity className="h-5 w-5 text-[rgb(var(--color-primary-600))]" />
                <div>
                  <CardTitle>
                    {selectedReport
                      ? t(selectedReport.titleKey, { defaultValue: selectedReport.titleDefault })
                      : t('reportsPage.fallbackTitle', { defaultValue: 'Report' })}
                  </CardTitle>
                  <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
                    {t('reportsPage.dateRange.lastDays', {
                      defaultValue: 'Last {{count}} days',
                      count: rangeDays,
                    })}
                  </p>
                </div>
              </div>
              <PrintButton
                id="reports-print"
                size="sm"
                variant="outline"
              />
            </div>
          </CardHeader>
          <CardContent>
            {selectedReportId === 'ticket-aging' ? (
              <TicketAgingView rangeDays={rangeDays} />
            ) : selectedReportId === 'email-channel-health' ? (
              <EmailChannelHealthView rangeDays={rangeDays} />
            ) : selectedReportId === 'time-utilization' ? (
              <TimeUtilizationView rangeDays={rangeDays} />
            ) : selectedReportId === 'team-performance' ? (
              <TeamPerformanceView rangeDays={rangeDays} />
            ) : (
              <TicketWorkloadView rangeDays={rangeDays} />
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
