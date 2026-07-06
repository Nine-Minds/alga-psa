'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, ChevronDown, ChevronRight, Info, RefreshCw, Settings } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import {
  getAgreementProfitability,
  getClientProfitability,
  getProfitabilitySummary,
  getTicketProfitability,
  type AgreementProfitabilityRow,
  type ClientProfitabilityRow,
  type ContractLineProfitabilityRow,
  type ProfitabilityMetricFields,
  type ProfitabilitySummary,
  type TicketProfitabilityRow,
} from '@alga-psa/billing/actions';

type DateRange = {
  startDate: string;
  endDate: string;
};

export function getLastCompleteMonthRange(today = new Date()): DateRange {
  const firstOfCurrentMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const lastOfPreviousMonth = new Date(firstOfCurrentMonth);
  lastOfPreviousMonth.setUTCDate(0);
  const firstOfPreviousMonth = new Date(Date.UTC(
    lastOfPreviousMonth.getUTCFullYear(),
    lastOfPreviousMonth.getUTCMonth(),
    1
  ));

  return {
    startDate: firstOfPreviousMonth.toISOString().slice(0, 10),
    endDate: lastOfPreviousMonth.toISOString().slice(0, 10),
  };
}

function idPart(value: string | null | undefined): string {
  return (value || 'none').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}

function ratioBadgeVariant(value: number | null): 'success' | 'warning' | 'error' | 'secondary' {
  if (value === null) return 'secondary';
  if (value < 0) return 'error';
  if (value < 20) return 'warning';
  return 'success';
}

function hasWarnings(fields: ProfitabilityMetricFields): boolean {
  return fields.uncostedMinutes > 0
    || fields.unattributedMinutes > 0
    || fields.unapprovedMinutes > 0
    || fields.zeroDurationEntryCount > 0
    || fields.uncostedMaterialCount > 0
    || fields.unconvertedRevenueCount > 0
    || fields.materialCurrencyMismatchCount > 0;
}

function warningItems(fields: ProfitabilityMetricFields, t: ReturnType<typeof useTranslation>['t']): string[] {
  return [
    fields.uncostedMinutes > 0 && t('contractReports.profitability.warnings.uncostedMinutes', {
      defaultValue: '{{hours}} uncosted hours',
      hours: (fields.uncostedMinutes / 60).toFixed(1),
    }),
    fields.unattributedMinutes > 0 && t('contractReports.profitability.warnings.unattributedMinutes', {
      defaultValue: '{{hours}} unattributed hours',
      hours: (fields.unattributedMinutes / 60).toFixed(1),
    }),
    fields.unapprovedMinutes > 0 && t('contractReports.profitability.warnings.unapprovedMinutes', {
      defaultValue: '{{hours}} unapproved hours included',
      hours: (fields.unapprovedMinutes / 60).toFixed(1),
    }),
    fields.zeroDurationEntryCount > 0 && t('contractReports.profitability.warnings.zeroDuration', {
      defaultValue: '{{count}} zero-duration entries',
      count: fields.zeroDurationEntryCount,
    }),
    fields.uncostedMaterialCount > 0 && t('contractReports.profitability.warnings.uncostedMaterials', {
      defaultValue: '{{count}} uncosted materials',
      count: fields.uncostedMaterialCount,
    }),
    fields.unconvertedRevenueCount > 0 && t('contractReports.profitability.warnings.unconvertedRevenue', {
      defaultValue: '{{count}} unconverted revenue rows',
      count: fields.unconvertedRevenueCount,
    }),
    fields.materialCurrencyMismatchCount > 0 && t('contractReports.profitability.warnings.materialCurrencyMismatch', {
      defaultValue: '{{count}} material currency mismatches',
      count: fields.materialCurrencyMismatchCount,
    }),
  ].filter(Boolean) as string[];
}

function rowName(row: AgreementProfitabilityRow): string {
  return row.contractName;
}

const ProfitabilityReport: React.FC = () => {
  const { t } = useTranslation('msp/reports');
  const { formatCurrency } = useFormatters();
  const defaultRange = useMemo(() => getLastCompleteMonthRange(), []);
  const [dateRange, setDateRange] = useState<DateRange>(defaultRange);
  const [draftRange, setDraftRange] = useState<DateRange>(defaultRange);
  const [summary, setSummary] = useState<ProfitabilitySummary | null>(null);
  const [clients, setClients] = useState<ClientProfitabilityRow[]>([]);
  const [agreements, setAgreements] = useState<AgreementProfitabilityRow[]>([]);
  const [tickets, setTickets] = useState<TicketProfitabilityRow[]>([]);
  const [selectedClient, setSelectedClient] = useState<ClientProfitabilityRow | null>(null);
  const [selectedAgreement, setSelectedAgreement] = useState<AgreementProfitabilityRow | null>(null);
  const [expandedAgreements, setExpandedAgreements] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currencyCode = summary?.currencyCode ?? 'USD';
  const formatCents = (cents: number): string => formatCurrency(cents / 100, currencyCode);
  const formatPercent = (value: number | null): string => (
    value === null
      ? t('units.dash', { defaultValue: '-' })
      : t('contractReports.profitability.formats.percent', { defaultValue: '{{value}}%', value: value.toFixed(1) })
  );
  const formatHours = (minutes: number): string => t('contractReports.profitability.formats.hours', {
    defaultValue: '{{value}} hrs',
    value: (minutes / 60).toFixed(1),
  });
  const formatRate = (cents: number | null): string => (
    cents === null
      ? t('units.dash', { defaultValue: '-' })
      : t('contractReports.profitability.formats.hourlyRate', {
        defaultValue: '{{value}}/hr',
        value: formatCents(cents),
      })
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const [summaryData, clientRows, agreementRows, ticketRows] = await Promise.all([
          getProfitabilitySummary(dateRange),
          getClientProfitability(dateRange),
          getAgreementProfitability({
            ...dateRange,
            clientId: selectedClient?.clientId ?? undefined,
          }),
          getTicketProfitability({
            ...dateRange,
            clientId: selectedClient?.clientId ?? undefined,
            clientContractId: selectedAgreement?.clientContractId ?? undefined,
          }),
        ]);

        if (cancelled) return;
        setSummary(summaryData);
        setClients(clientRows);
        setAgreements(agreementRows);
        setTickets(ticketRows);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t('contractReports.profitability.errors.load', {
          defaultValue: 'Failed to load profitability data',
        }));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [dateRange, selectedClient, selectedAgreement, t]);

  useEffect(() => {
    setSelectedAgreement(null);
    setExpandedAgreements(new Set());
  }, [selectedClient]);

  const metricColumns = <T extends ProfitabilityMetricFields>(nameColumn: ColumnDefinition<T>): ColumnDefinition<T>[] => [
    nameColumn,
    {
      title: t('contractReports.profitability.table.revenue', { defaultValue: 'Revenue' }),
      dataIndex: 'revenue',
      render: (value: number) => formatCents(value),
    },
    {
      title: t('contractReports.profitability.table.laborCost', { defaultValue: 'Labor Cost' }),
      dataIndex: 'laborCost',
      render: (value: number) => formatCents(value),
    },
    {
      title: t('contractReports.profitability.table.materialCost', { defaultValue: 'Material Cost' }),
      dataIndex: 'materialCost',
      render: (value: number) => formatCents(value),
    },
    {
      title: t('contractReports.profitability.table.margin', { defaultValue: 'Margin' }),
      dataIndex: 'margin',
      render: (value: number) => formatCents(value),
    },
    {
      title: t('contractReports.profitability.table.marginPct', { defaultValue: 'Margin %' }),
      dataIndex: 'marginPct',
      render: (value: number | null) => (
        <Badge variant={ratioBadgeVariant(value)}>{formatPercent(value)}</Badge>
      ),
    },
    {
      title: t('contractReports.profitability.table.hours', { defaultValue: 'Hours' }),
      dataIndex: 'totalMinutes',
      render: (value: number) => formatHours(value),
    },
    {
      title: t('contractReports.profitability.table.ehr', { defaultValue: 'EHR' }),
      dataIndex: 'effectiveHourlyRate',
      render: (value: number | null) => formatRate(value),
    },
  ];

  const clientColumns: ColumnDefinition<ClientProfitabilityRow>[] = metricColumns<ClientProfitabilityRow>({
    title: t('contractReports.profitability.table.client', { defaultValue: 'Client' }),
    dataIndex: 'clientName',
    render: (value: string, record: ClientProfitabilityRow) => (
      <div className="flex items-center gap-2">
        <span className="font-medium">{value}</span>
        {hasWarnings(record) && (
          <span
            className="inline-flex"
            title={warningItems(record, t).join(t('contractReports.profitability.formats.listSeparator', { defaultValue: ', ' }))}
          >
            <AlertCircle className="h-4 w-4 text-amber-600" aria-hidden="true" />
          </span>
        )}
      </div>
    ),
  });

  const agreementColumns: ColumnDefinition<AgreementProfitabilityRow>[] = metricColumns<AgreementProfitabilityRow>({
    title: t('contractReports.profitability.table.agreement', { defaultValue: 'Agreement' }),
    dataIndex: 'contractName',
    render: (_value: string, record: AgreementProfitabilityRow) => (
      <div className="flex items-center gap-2">
        <Button
          id={`profitability-toggle-lines-${idPart(record.clientContractId ?? record.rowType)}`}
          type="button"
          variant="ghost"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            const key = record.clientContractId ?? record.rowType;
            setExpandedAgreements((current) => {
              const next = new Set(current);
              if (next.has(key)) {
                next.delete(key);
              } else {
                next.add(key);
              }
              return next;
            });
          }}
        >
          {expandedAgreements.has(record.clientContractId ?? record.rowType)
            ? <ChevronDown className="h-4 w-4" aria-hidden="true" />
            : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
          <span className="sr-only">{t('contractReports.profitability.actions.toggleLines', { defaultValue: 'Toggle lines' })}</span>
        </Button>
        <span className="font-medium">{rowName(record)}</span>
        {record.rowType !== 'agreement' && (
          <Badge variant="secondary">
            {record.rowType === 'ad_hoc'
              ? t('contractReports.profitability.rowTypes.adHoc', { defaultValue: 'Ad-hoc' })
              : t('contractReports.profitability.rowTypes.unattributed', { defaultValue: 'Unattributed' })}
          </Badge>
        )}
      </div>
    ),
  });

  const ticketColumns: ColumnDefinition<TicketProfitabilityRow>[] = metricColumns<TicketProfitabilityRow>({
    title: t('contractReports.profitability.table.ticket', { defaultValue: 'Ticket' }),
    dataIndex: 'title',
    render: (_value: string | null, record: TicketProfitabilityRow) => (
      <div className="flex flex-col">
        <span className="font-medium">
          {record.ticketNumber
            ? t('contractReports.profitability.formats.ticketWithNumber', {
              defaultValue: '#{{number}} {{title}}',
              number: record.ticketNumber,
              title: record.title || t('contractReports.profitability.fallbacks.untitledTicket', { defaultValue: 'Untitled ticket' }),
            })
            : record.title || t('contractReports.profitability.fallbacks.untitledTicket', { defaultValue: 'Untitled ticket' })}
        </span>
        <span className="text-xs text-muted-foreground">
          {t('contractReports.profitability.formats.billableHours', {
            defaultValue: '{{value}} billable hrs',
            value: (record.billableMinutes / 60).toFixed(1),
          })}
        </span>
      </div>
    ),
  });

  const ticketColumnsWithStatus: ColumnDefinition<TicketProfitabilityRow>[] = [
    ...ticketColumns,
    {
      title: t('contractReports.profitability.table.attribution', { defaultValue: 'Attribution' }),
      dataIndex: 'attribution',
      render: (value: TicketProfitabilityRow['attribution'], record: TicketProfitabilityRow) => (
        <div className="flex items-center gap-2">
          <Badge variant={value === 'exact' ? 'success' : value === 'allocated' ? 'warning' : 'secondary'}>
            {value === 'exact'
              ? t('contractReports.profitability.attribution.exact', { defaultValue: 'Exact' })
              : value === 'allocated'
                ? t('contractReports.profitability.attribution.allocated', { defaultValue: 'Allocated' })
                : t('contractReports.profitability.attribution.none', { defaultValue: 'None' })}
          </Badge>
          {record.uncosted && (
            <Badge variant="error">
              {t('contractReports.profitability.status.uncosted', { defaultValue: 'Uncosted' })}
            </Badge>
          )}
        </div>
      ),
    },
  ];

  const selectedAgreementKey = selectedAgreement?.clientContractId ?? null;
  const visibleTickets = tickets.filter((ticket) => (
    !selectedAgreementKey || ticket.clientContractId === selectedAgreementKey
  ));

  const summaryWarnings = summary ? warningItems(summary, t) : [];

  const applyDateRange = (event: React.FormEvent) => {
    event.preventDefault();
    setSelectedClient(null);
    setSelectedAgreement(null);
    setDateRange(draftRange);
  };

  if (loading) {
    return (
      <div className="space-y-4" id="profitability-report-loading">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={`profitability-summary-skeleton-${index}`} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" id="profitability-error-alert">
        <AlertDescription>
          <p className="font-semibold mb-1">
            {t('contractReports.profitability.errors.title', { defaultValue: 'Error Loading Profitability' })}
          </p>
          <p>{error}</p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-5" id="profitability-report">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">
              {t('contractReports.sections.profitability.title', { defaultValue: 'Profitability Report' })}
            </h3>
            <span
              title={t('contractReports.profitability.timingTooltip', {
                defaultValue: 'Revenue is filtered by invoice date. Labor cost is filtered by work date. Billed material cost follows invoice date; unbilled material cost follows created date.',
              })}
            >
              <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('contractReports.sections.profitability.description', {
              defaultValue: 'Client, agreement, and ticket margin using configured internal labor cost rates.',
            })}
          </p>
        </div>

        <form className="flex flex-wrap items-end gap-2" onSubmit={applyDateRange}>
          <div className="space-y-1">
            <Label htmlFor="profitability-start-date">{t('contractReports.profitability.filters.startDate', { defaultValue: 'Start Date' })}</Label>
            <Input
              id="profitability-start-date"
              type="date"
              value={draftRange.startDate}
              onChange={(event) => setDraftRange((current) => ({ ...current, startDate: event.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="profitability-end-date">{t('contractReports.profitability.filters.endDate', { defaultValue: 'End Date' })}</Label>
            <Input
              id="profitability-end-date"
              type="date"
              value={draftRange.endDate}
              onChange={(event) => setDraftRange((current) => ({ ...current, endDate: event.target.value }))}
            />
          </div>
          <Button id="profitability-apply-date-range" type="submit">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {t('contractReports.profitability.actions.apply', { defaultValue: 'Apply' })}
          </Button>
        </form>
      </div>

      {summary && !summary.costRatesConfigured && (
        <Alert id="profitability-cost-rates-empty-state">
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {t('contractReports.profitability.empty.costRates', {
                defaultValue: 'Cost rates are not configured. Labor hours are shown as uncosted until a tenant default or user rate exists.',
              })}
            </span>
            <Button id="profitability-settings-link" asChild size="sm" variant="secondary">
              <Link href="/msp/settings?tab=billing&section=cost-rates">
                <Settings className="h-4 w-4" aria-hidden="true" />
                {t('contractReports.profitability.actions.configureCostRates', { defaultValue: 'Configure Cost Rates' })}
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {summaryWarnings.length > 0 && (
        <Alert id="profitability-warning-alert">
          <AlertDescription>
            <p className="font-medium mb-1">
              {t('contractReports.profitability.warnings.title', { defaultValue: 'Report warnings' })}
            </p>
            <p className="text-sm">{summaryWarnings.join(t('contractReports.profitability.formats.listSeparator', { defaultValue: ', ' }))}</p>
          </AlertDescription>
        </Alert>
      )}

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
          {[
            [t('contractReports.profitability.summary.revenue', { defaultValue: 'Revenue' }), formatCents(summary.revenue)],
            [t('contractReports.profitability.summary.laborCost', { defaultValue: 'Labor Cost' }), formatCents(summary.laborCost)],
            [t('contractReports.profitability.summary.materialCost', { defaultValue: 'Material Cost' }), formatCents(summary.materialCost)],
            [t('contractReports.profitability.summary.margin', { defaultValue: 'Margin' }), formatCents(summary.margin)],
            [t('contractReports.profitability.summary.marginPct', { defaultValue: 'Margin %' }), formatPercent(summary.marginPct)],
            [t('contractReports.profitability.summary.ehr', { defaultValue: 'Effective Hourly Rate' }), formatRate(summary.effectiveHourlyRate)],
          ].map(([label, value]) => (
            <Card key={label} className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-xl font-semibold mt-1">{value}</p>
            </Card>
          ))}
        </div>
      )}

      <Card className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div>
            <h4 className="font-semibold">{t('contractReports.profitability.sections.clients', { defaultValue: 'Clients' })}</h4>
            <p className="text-sm text-muted-foreground">
              {t('contractReports.profitability.sections.clientsDescription', { defaultValue: 'Select a client to drill into agreements and tickets.' })}
            </p>
          </div>
          {selectedClient && (
            <Button
              id="profitability-clear-client"
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSelectedClient(null)}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t('contractReports.profitability.actions.clearClient', { defaultValue: 'All Clients' })}
            </Button>
          )}
        </div>
        {clients.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {t('contractReports.profitability.empty.clients', { defaultValue: 'No client profitability data available for this range.' })}
          </p>
        ) : (
          <DataTable
            id="profitability-client-table"
            data={clients}
            columns={clientColumns}
            pagination
            pageSize={10}
            initialSorting={[{ id: 'marginPct', desc: false }]}
            onRowClick={(row) => {
              setSelectedClient(row);
              setSelectedAgreement(null);
            }}
            rowClassName={(record) => record.clientId === selectedClient?.clientId ? 'bg-[rgb(var(--color-primary-50))]' : ''}
          />
        )}
      </Card>

      {selectedClient && (
        <Card className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h4 className="font-semibold">
                {t('contractReports.profitability.sections.agreements', {
                  defaultValue: 'Agreements for {{client}}',
                  client: selectedClient.clientName,
                })}
              </h4>
              <p className="text-sm text-muted-foreground">
                {t('contractReports.profitability.sections.agreementsDescription', { defaultValue: 'Ad-hoc and unattributed rows are included so totals reconcile.' })}
              </p>
            </div>
            {selectedAgreement && (
              <Button
                id="profitability-clear-agreement"
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setSelectedAgreement(null)}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                {t('contractReports.profitability.actions.clearAgreement', { defaultValue: 'All Agreements' })}
              </Button>
            )}
          </div>
          <DataTable
            id="profitability-agreement-table"
            data={agreements}
            columns={agreementColumns}
            pagination
            pageSize={10}
            onRowClick={(row) => setSelectedAgreement(row)}
            rowClassName={(record) => (
              (record.clientContractId ?? record.rowType) === (selectedAgreement?.clientContractId ?? selectedAgreement?.rowType)
              ? 'bg-[rgb(var(--color-primary-50))]'
                : ''
            )}
          />

          {agreements
            .filter((agreement) => expandedAgreements.has(agreement.clientContractId ?? agreement.rowType))
            .map((agreement) => (
              <div key={`lines-${agreement.clientContractId ?? agreement.rowType}`} className="mt-4 overflow-x-auto">
                <h5 className="text-sm font-semibold mb-2">
                  {t('contractReports.profitability.sections.linesForAgreement', {
                    defaultValue: 'Contract lines for {{agreement}}',
                    agreement: rowName(agreement),
                  })}
                </h5>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[rgb(var(--color-border-200))] text-left">
                      <th className="py-2 pr-3">{t('contractReports.profitability.table.contractLine', { defaultValue: 'Line' })}</th>
                      <th className="py-2 pr-3">{t('contractReports.profitability.table.revenue', { defaultValue: 'Revenue' })}</th>
                      <th className="py-2 pr-3">{t('contractReports.profitability.table.cost', { defaultValue: 'Cost' })}</th>
                      <th className="py-2 pr-3">{t('contractReports.profitability.table.margin', { defaultValue: 'Margin' })}</th>
                      <th className="py-2 pr-3">{t('contractReports.profitability.table.hours', { defaultValue: 'Hours' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agreement.lines.length === 0 ? (
                      <tr>
                        <td className="py-3 text-muted-foreground" colSpan={5}>
                          {t('contractReports.profitability.empty.lines', { defaultValue: 'No line-level detail for this row.' })}
                        </td>
                      </tr>
                    ) : agreement.lines.map((line: ContractLineProfitabilityRow) => (
                      <tr key={line.contractLineId ?? line.rowType} className="border-b border-[rgb(var(--color-border-100))]">
                        <td className="py-2 pr-3">
                          <span>{line.contractLineName}</span>
                          {line.rowType === 'unassigned' && (
                            <Badge className="ml-2" variant="secondary">
                              {t('contractReports.profitability.rowTypes.unassigned', { defaultValue: 'Unassigned' })}
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 pr-3">{formatCents(line.revenue)}</td>
                        <td className="py-2 pr-3">{formatCents(line.laborCost + line.materialCost)}</td>
                        <td className="py-2 pr-3">{formatCents(line.margin)}</td>
                        <td className="py-2 pr-3">{formatHours(line.totalMinutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </Card>
      )}

      {selectedClient && (
        <Card className="p-5">
          <div className="mb-4">
            <h4 className="font-semibold">{t('contractReports.profitability.sections.tickets', { defaultValue: 'Tickets' })}</h4>
            <p className="text-sm text-muted-foreground">
              {selectedAgreement
                ? t('contractReports.profitability.sections.ticketsForAgreement', {
                  defaultValue: 'Ticket cost and revenue for {{agreement}}.',
                  agreement: rowName(selectedAgreement),
                })
                : t('contractReports.profitability.sections.ticketsDescription', { defaultValue: 'Ticket-level labor, material cost, attributed revenue, and margin.' })}
            </p>
          </div>
          {visibleTickets.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {t('contractReports.profitability.empty.tickets', { defaultValue: 'No ticket profitability data available for this selection.' })}
            </p>
          ) : (
            <DataTable
              id="profitability-ticket-table"
              data={visibleTickets}
              columns={ticketColumnsWithStatus}
              pagination
              pageSize={10}
            />
          )}
        </Card>
      )}
    </div>
  );
};

export default ProfitabilityReport;
