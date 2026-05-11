'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Clock3,
  FileBarChart,
  LineChart,
  Lock,
  type LucideIcon,
  Mail,
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
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getTicketAgingReport,
  getTicketWorkloadReport,
  type ReportBucket,
  type ReportRangeDays,
  type TicketAgingReport,
  type TicketWorkloadReport,
} from '@alga-psa/reporting/actions';

type ReportCategory = 'helpdesk' | 'operations' | 'billing';
type ReportKind = 'embedded' | 'link' | 'planned';
type EmbeddedReportId = 'ticket-workload' | 'ticket-aging';

interface ReportDefinition {
  id: EmbeddedReportId | 'email-channel-health' | 'time-utilization' | 'team-performance' | 'contract-reports';
  title: string;
  description: string;
  category: ReportCategory;
  products: ProductCode[];
  minimumTier: TenantTier;
  kind: ReportKind;
  href?: string;
  icon: LucideIcon;
}

interface ReportsProps {
  productCode?: ProductCode;
  tier?: TenantTier;
}

const REPORTS: ReportDefinition[] = [
  {
    id: 'ticket-workload',
    title: 'Ticket Workload',
    description: 'Created, closed, and currently open tickets grouped by status, priority, and assignee.',
    category: 'helpdesk',
    products: ['psa', 'algadesk'],
    minimumTier: 'solo',
    kind: 'embedded',
    icon: BarChart3,
  },
  {
    id: 'ticket-aging',
    title: 'Ticket Aging',
    description: 'Open-ticket age buckets, response ownership, and oldest active tickets.',
    category: 'helpdesk',
    products: ['psa', 'algadesk'],
    minimumTier: 'solo',
    kind: 'embedded',
    icon: Timer,
  },
  {
    id: 'email-channel-health',
    title: 'Email Channel Health',
    description: 'Configured channels, active mailboxes, and connection health. Coming next.',
    category: 'helpdesk',
    products: ['psa', 'algadesk'],
    minimumTier: 'solo',
    kind: 'planned',
    icon: Mail,
  },
  {
    id: 'time-utilization',
    title: 'Time Utilization',
    description: 'Tracked work by person and service area for PSA operations.',
    category: 'operations',
    products: ['psa'],
    minimumTier: 'solo',
    kind: 'planned',
    icon: Clock3,
  },
  {
    id: 'team-performance',
    title: 'Team Performance',
    description: 'Team-level throughput and response ownership for multi-user workspaces.',
    category: 'operations',
    products: ['psa'],
    minimumTier: 'pro',
    kind: 'planned',
    icon: Users,
  },
  {
    id: 'contract-reports',
    title: 'Contract Reports',
    description: 'Contract revenue, renewals, bucket utilization, and simple profitability.',
    category: 'billing',
    products: ['psa'],
    minimumTier: 'pro',
    kind: 'link',
    href: '/msp/billing?tab=reports',
    icon: FileBarChart,
  },
];

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  helpdesk: 'Help desk',
  operations: 'Operations',
  billing: 'Billing',
};

function canAccessReport(report: ReportDefinition, productCode: ProductCode, tier: TenantTier): boolean {
  return report.products.includes(productCode) && tierAtLeast(tier, report.minimumTier);
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-3">
      <p className="text-xs font-medium text-[rgb(var(--color-text-500))]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[rgb(var(--color-text-900))]">{value}</p>
    </div>
  );
}

function BucketList({ title, buckets }: { title: string; buckets: ReportBucket[] }) {
  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);

  return (
    <div className="rounded-md border border-[rgb(var(--color-border-200))] p-4">
      <h3 className="text-sm font-semibold text-[rgb(var(--color-text-900))]">{title}</h3>
      <div className="mt-3 space-y-3">
        {buckets.length === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-500))]">No data for this report.</p>
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
  const [report, setReport] = useState<TicketWorkloadReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    getTicketWorkloadReport(rangeDays)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load report.');
      });
    return () => {
      cancelled = true;
    };
  }, [rangeDays]);

  if (error) return <p className="text-sm text-[rgb(var(--color-destructive-600))]">{error}</p>;
  if (!report) return <LoadingReport />;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-5">
        <MetricCard label="Created" value={report.summary.created} />
        <MetricCard label="Closed" value={report.summary.closed} />
        <MetricCard label="Open now" value={report.summary.open} />
        <MetricCard label="Awaiting customer" value={report.summary.awaitingCustomer} />
        <MetricCard label="Awaiting internal" value={report.summary.awaitingInternal} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <BucketList title="Open by status" buckets={report.byStatus} />
        <BucketList title="Open by priority" buckets={report.byPriority} />
        <BucketList title="Open by assignee" buckets={report.byAssignee} />
      </div>
    </div>
  );
}

function TicketAgingView({ rangeDays }: { rangeDays: ReportRangeDays }) {
  const [report, setReport] = useState<TicketAgingReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    getTicketAgingReport(rangeDays)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load report.');
      });
    return () => {
      cancelled = true;
    };
  }, [rangeDays]);

  if (error) return <p className="text-sm text-[rgb(var(--color-destructive-600))]">{error}</p>;
  if (!report) return <LoadingReport />;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-5">
        <MetricCard label="Open now" value={report.summary.open} />
        <MetricCard label="Under 2 days" value={report.summary.under2Days} />
        <MetricCard label="2 to 7 days" value={report.summary.days2To7} />
        <MetricCard label="8 to 30 days" value={report.summary.days8To30} />
        <MetricCard label="Over 30 days" value={report.summary.over30Days} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <BucketList title="Age distribution" buckets={report.byAge} />
        <BucketList title="Response ownership" buckets={report.byResponseState} />
      </div>
      <div className="rounded-md border border-[rgb(var(--color-border-200))]">
        <div className="border-b border-[rgb(var(--color-border-200))] p-4">
          <h3 className="text-sm font-semibold text-[rgb(var(--color-text-900))]">Oldest open tickets</h3>
        </div>
        <div className="divide-y divide-[rgb(var(--color-border-200))]">
          {report.oldestOpenTickets.length === 0 ? (
            <p className="p-4 text-sm text-[rgb(var(--color-text-500))]">No open tickets in this range.</p>
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
                  {ticket.enteredAt ? new Date(ticket.enteredAt).toLocaleDateString() : 'No date'}
                </span>
                <span className="font-medium text-[rgb(var(--color-text-900))]">{ticket.ageDays} days</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
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
              Canned operational reports for the current workspace. More customization will layer onto this catalog later.
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
                        <CardTitle className="text-base">{report.title}</CardTitle>
                        <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">{CATEGORY_LABELS[report.category]}</p>
                      </div>
                    </div>
                    {!hasAccess ? (
                      <Badge variant="warning" className="gap-1">
                        <Lock className="h-3 w-3" />
                        {TIER_LABELS[report.minimumTier]}
                      </Badge>
                    ) : report.kind === 'planned' ? (
                      <Badge variant="default-muted">Planned</Badge>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="min-h-12 text-sm text-[rgb(var(--color-text-600))]">{report.description}</p>
                  {report.kind === 'embedded' ? (
                    <Button
                      id={`reports-view-${report.id}`}
                      variant={isSelected ? 'default' : 'outline'}
                      size="sm"
                      disabled={!hasAccess}
                      onClick={() => setSelectedReportId(report.id as EmbeddedReportId)}
                    >
                      View report
                    </Button>
                  ) : report.kind === 'link' && report.href ? (
                    hasAccess ? (
                      <Button id={`reports-open-${report.id}`} asChild size="sm" variant="outline">
                        <Link href={report.href}>Open in billing</Link>
                      </Button>
                    ) : (
                      <Button id={`reports-locked-${report.id}`} size="sm" variant="outline" disabled>
                        Requires {TIER_LABELS[report.minimumTier]}
                      </Button>
                    )
                  ) : (
                    <Button id={`reports-planned-${report.id}`} size="sm" variant="outline" disabled>
                      Coming soon
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-[rgb(var(--color-primary-600))]" />
              <div>
                <CardTitle>{selectedReport?.title ?? 'Report'}</CardTitle>
                <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
                  Last {rangeDays} days
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {selectedReportId === 'ticket-aging' ? (
              <TicketAgingView rangeDays={rangeDays} />
            ) : (
              <TicketWorkloadView rangeDays={rangeDays} />
            )}
          </CardContent>
        </Card>

        {productCode === 'psa' ? (
          <Card>
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <LineChart className="h-5 w-5 text-[rgb(var(--color-primary-600))]" />
                <div>
                  <p className="font-medium text-[rgb(var(--color-text-900))]">Billing reports live in the billing workspace</p>
                  <p className="text-sm text-[rgb(var(--color-text-500))]">
                    Contract revenue, expiration, bucket usage, and profitability are available from Billing.
                  </p>
                </div>
              </div>
              <Button id="reports-open-billing-reports" asChild size="sm" variant="outline">
                <Link href="/msp/billing?tab=reports">Open billing reports</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
