'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { PrintButton } from '@alga-psa/ui/components/PrintButton';
import { PrintableTable, type PrintableTableColumn } from '@alga-psa/ui/components/PrintableTable';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getDeferredRevenueReport,
  type DeferredRevenueReport as DeferredRevenueReportPayload,
  type BucketDetailRow,
  type CreditDetailRow,
  type CurrencySection,
  type MovementColumns,
} from '@alga-psa/reporting/actions/report-actions/getDeferredRevenueReport';
import { defaultReportMonth } from '@alga-psa/reporting/actions/report-actions/deferred-revenue/month';

const isReportActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

function formatCents(cents: number, currency: string, formatCurrency: (value: number, currency: string) => string): string {
  return formatCurrency(cents / 100, currency);
}

/**
 * Single source of truth for the expansion key. A client may appear in more
 * than one currency section, so the key must be the client×currency composite
 * — and it must be derived in exactly one place so the toggle and the render
 * check can never drift. The NUL separator cannot appear in a client UUID or
 * a currency code.
 */
function clientExpansionKey(client: { clientId: string; currencyCode: string }): string {
  return `${client.clientId}\u0000${client.currencyCode}`;
}

interface CsvColumn {
  key: string;
  header: string;
  value: (row: ClientCsvRow) => number | string;
}

interface ClientCsvRow {
  clientId: string;
  clientName: string;
  currencyCode: string;
  credits: MovementColumns;
  hours: MovementColumns;
  total: MovementColumns;
}

function csvValue(value: number | string): string {
  const string = String(value);
  if (/[",\n]/.test(string)) {
    return `"${string.replace(/"/g, '""')}"`;
  }
  return string;
}

function downloadCsv(filename: string, headers: string[], rows: ClientCsvRow[], columns: CsvColumn[]): void {
  const lines = [
    headers.join(','),
    ...rows.map((row) => columns.map((column) => csvValue(column.value(row))).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function MovementCells({
  movement,
  currency,
  showAdjustments,
  formatCurrency,
  className,
}: {
  movement: MovementColumns;
  currency: string;
  showAdjustments: boolean;
  formatCurrency: (value: number, currency: string) => string;
  className?: string;
}) {
  const cells = [
    movement.opening,
    movement.issued,
    movement.applied,
    movement.expired,
  ];
  if (showAdjustments) cells.push(movement.adjustments);
  cells.push(movement.closing);

  return (
    <>
      {cells.map((value, index) => (
        <td
          key={index}
          className={`whitespace-nowrap px-3 py-2 text-right tabular-nums text-[rgb(var(--color-text-700))] ${className ?? ''}`}
        >
          {formatCents(value, currency, formatCurrency)}
        </td>
      ))}
    </>
  );
}

function CreditDetailList({ details, currency, formatCurrency }: { details: CreditDetailRow[]; currency: string; formatCurrency: (value: number, currency: string) => string }) {
  const { t } = useTranslation('msp/reports');
  return (
    <div className="px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--color-text-500))]">
        {t('deferredRevenue.detail.credits', { defaultValue: 'Credit balances' })}
      </p>
      {details.length === 0 ? (
        <p className="mt-2 text-sm text-[rgb(var(--color-text-500))]">
          {t('deferredRevenue.detail.noCredits', { defaultValue: 'No credit entries.' })}
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full divide-y divide-[rgb(var(--color-border-200))] text-sm">
            <thead className="bg-[rgb(var(--color-background-100))]">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-[rgb(var(--color-text-600))]">{t('deferredRevenue.detail.date', { defaultValue: 'Issued' })}</th>
                <th className="px-3 py-2 text-left font-medium text-[rgb(var(--color-text-600))]">{t('deferredRevenue.detail.description', { defaultValue: 'Description' })}</th>
                <th className="px-3 py-2 text-right font-medium text-[rgb(var(--color-text-600))]">{t('deferredRevenue.detail.remaining', { defaultValue: 'Remaining' })}</th>
                <th className="px-3 py-2 text-left font-medium text-[rgb(var(--color-text-600))]">{t('deferredRevenue.detail.expires', { defaultValue: 'Expires' })}</th>
                <th className="px-3 py-2 text-left font-medium text-[rgb(var(--color-text-600))]">{t('deferredRevenue.detail.qbo', { defaultValue: 'QBO' })}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgb(var(--color-border-200))]">
              {details.map((detail) => (
                <tr key={detail.creditId}>
                  <td className="px-3 py-2 whitespace-nowrap text-[rgb(var(--color-text-700))]">
                    {detail.issuedDate ? new Date(detail.issuedDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-2 text-[rgb(var(--color-text-700))]">
                    {detail.description || detail.sourceKind}
                    {detail.invoiceNumber ? <span className="ml-2 text-xs text-[rgb(var(--color-text-500))]">{detail.invoiceNumber}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[rgb(var(--color-text-700))]">
                    {formatCents(detail.remainingAmount, currency, formatCurrency)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-[rgb(var(--color-text-700))]">
                    {detail.expirationDate ? new Date(detail.expirationDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-2 text-[rgb(var(--color-text-700))]">
                    {detail.qboReachable ? (
                      <span className="text-[rgb(var(--color-text-600))]">{t('deferredRevenue.detail.reachable', { defaultValue: 'Synced' })}</span>
                    ) : (
                      <span className="font-medium text-[rgb(var(--color-destructive-600))]" title={t('deferredRevenue.detail.notReachableTitle', { defaultValue: 'Prepayment / project-deposit credits never export to QuickBooks — Alga is the system of record.' })}>
                        {t('deferredRevenue.detail.notReachable', { defaultValue: 'Not in QBO' })}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BucketDetailList({ details, currency, formatCurrency }: { details: BucketDetailRow[]; currency: string; formatCurrency: (value: number, currency: string) => string }) {
  const { t } = useTranslation('msp/reports');
  return (
    <div className="px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--color-text-500))]">
        {t('deferredRevenue.detail.buckets', { defaultValue: 'Prepaid bucket hours' })}
      </p>
      {details.length === 0 ? (
        <p className="mt-2 text-sm text-[rgb(var(--color-text-500))]">
          {t('deferredRevenue.detail.noBuckets', { defaultValue: 'No prepaid bucket periods.' })}
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full divide-y divide-[rgb(var(--color-border-200))] text-sm">
            <thead className="bg-[rgb(var(--color-background-100))]">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-[rgb(var(--color-text-600))]">{t('deferredRevenue.detail.line', { defaultValue: 'Line' })}</th>
                <th className="px-3 py-2 text-left font-medium text-[rgb(var(--color-text-600))]">{t('deferredRevenue.detail.period', { defaultValue: 'Period' })}</th>
                <th className="px-3 py-2 text-right font-medium text-[rgb(var(--color-text-600))]">{t('deferredRevenue.detail.included', { defaultValue: 'Included' })}</th>
                <th className="px-3 py-2 text-right font-medium text-[rgb(var(--color-text-600))]">{t('deferredRevenue.detail.used', { defaultValue: 'Used' })}</th>
                <th className="px-3 py-2 text-right font-medium text-[rgb(var(--color-text-600))]">{t('deferredRevenue.detail.remaining', { defaultValue: 'Remaining' })}</th>
                <th className="px-3 py-2 text-right font-medium text-[rgb(var(--color-text-600))]">{t('deferredRevenue.detail.value', { defaultValue: 'Value' })}</th>
                <th className="px-3 py-2 text-left font-medium text-[rgb(var(--color-text-600))]">{t('deferredRevenue.detail.feeSource', { defaultValue: 'Fee' })}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgb(var(--color-border-200))]">
              {details.map((detail) => (
                <tr key={detail.usageId}>
                  <td className="px-3 py-2 text-[rgb(var(--color-text-700))]">
                    {detail.contractLineName}
                    <span className="ml-2 text-xs text-[rgb(var(--color-text-500))]">{detail.serviceName}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-[rgb(var(--color-text-700))]">
                    {detail.periodStart} → {detail.periodEnd}
                    {detail.allowRollover ? (
                      <span className="ml-1 text-xs text-[rgb(var(--color-text-500))]">{t('deferredRevenue.detail.rollover', { defaultValue: 'rollover' })}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[rgb(var(--color-text-700))]">{detail.totalMinutes}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[rgb(var(--color-text-700))]">{detail.minutesUsed}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[rgb(var(--color-text-700))]">{detail.remainingMinutes}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[rgb(var(--color-text-700))]">
                    {formatCents(detail.valueRemaining, currency, formatCurrency)}
                  </td>
                  <td className="px-3 py-2 text-[rgb(var(--color-text-700))]">
                    {detail.notYetBilled ? (
                      <span className="text-[rgb(var(--color-text-500))]">{t('deferredRevenue.detail.notBilled', { defaultValue: 'Not yet billed' })}</span>
                    ) : (
                      <span>{t('deferredRevenue.detail.billed', { defaultValue: 'Billed' })}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SummaryCards({ sections, formatCurrency }: { sections: CurrencySection[]; formatCurrency: (value: number, currency: string) => string }) {
  const { t } = useTranslation('msp/reports');
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {sections.map((section) => {
        const delta = section.totals.total.closing - section.totals.total.opening;
        return (
          <div key={section.currencyCode} className="rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-[rgb(var(--color-text-500))]">
              {t('deferredRevenue.summary.totalLiability', { defaultValue: 'Total prepaid liability' })} · {section.currencyCode}
            </p>
            <p className="mt-2 text-2xl font-semibold text-[rgb(var(--color-text-900))]">
              {formatCents(section.totals.total.closing, section.currencyCode, formatCurrency)}
            </p>
            <div className="mt-3 space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[rgb(var(--color-text-500))]">{t('deferredRevenue.summary.credits', { defaultValue: 'Credits' })}</span>
                <span className="tabular-nums text-[rgb(var(--color-text-700))]">{formatCents(section.totals.credits.closing, section.currencyCode, formatCurrency)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[rgb(var(--color-text-500))]">{t('deferredRevenue.summary.hours', { defaultValue: 'Prepaid hours' })}</span>
                <span className="tabular-nums text-[rgb(var(--color-text-700))]">{formatCents(section.totals.hours.closing, section.currencyCode, formatCurrency)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[rgb(var(--color-text-500))]">{t('deferredRevenue.summary.delta', { defaultValue: 'Change vs prior month' })}</span>
                <span className={`tabular-nums ${delta >= 0 ? 'text-[rgb(var(--color-text-700))]' : 'text-[rgb(var(--color-destructive-600))]'}`}>
                  {formatCents(delta, section.currencyCode, formatCurrency)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DeferredRevenueTable({
  section,
  expandedClients,
  toggleClient,
  formatCurrency,
}: {
  section: CurrencySection;
  expandedClients: Set<string>;
  toggleClient: (clientId: string) => void;
  formatCurrency: (value: number, currency: string) => string;
}) {
  const { t } = useTranslation('msp/reports');
  const currency = section.currencyCode;

  return (
    <div className="overflow-x-auto rounded-md border border-[rgb(var(--color-border-200))]">
      <table className="min-w-full divide-y divide-[rgb(var(--color-border-200))] text-sm">
        <thead className="bg-[rgb(var(--color-background-100))]">
          <tr>
            <th rowSpan={2} className="px-4 py-3 text-left font-medium text-[rgb(var(--color-text-600))]">
              {t('deferredRevenue.table.client', { defaultValue: 'Client' })}
            </th>
            <th colSpan={6} className="border-b border-[rgb(var(--color-border-200))] px-3 py-2 text-center font-medium text-[rgb(var(--color-text-500))]">
              {t('deferredRevenue.table.credits', { defaultValue: 'Credits' })}
            </th>
            <th colSpan={5} className="border-b border-[rgb(var(--color-border-200))] px-3 py-2 text-center font-medium text-[rgb(var(--color-text-500))]">
              {t('deferredRevenue.table.hours', { defaultValue: 'Prepaid hours' })}
            </th>
            <th rowSpan={2} className="px-3 py-3 text-right font-medium text-[rgb(var(--color-text-600))]">
              {t('deferredRevenue.table.total', { defaultValue: 'Total closing' })}
            </th>
          </tr>
          <tr>
            <th className="px-3 py-2 text-right font-medium text-[rgb(var(--color-text-500))]">{t('deferredRevenue.table.opening', { defaultValue: 'Opening' })}</th>
            <th className="px-3 py-2 text-right font-medium text-[rgb(var(--color-text-500))]">{t('deferredRevenue.table.issued', { defaultValue: 'Issued' })}</th>
            <th className="px-3 py-2 text-right font-medium text-[rgb(var(--color-text-500))]">{t('deferredRevenue.table.applied', { defaultValue: 'Applied' })}</th>
            <th className="px-3 py-2 text-right font-medium text-[rgb(var(--color-text-500))]">{t('deferredRevenue.table.expired', { defaultValue: 'Expired' })}</th>
            <th className="px-3 py-2 text-right font-medium text-[rgb(var(--color-text-500))]">{t('deferredRevenue.table.adjustments', { defaultValue: 'Adj.' })}</th>
            <th className="px-3 py-2 text-right font-medium text-[rgb(var(--color-text-500))]">{t('deferredRevenue.table.closing', { defaultValue: 'Closing' })}</th>
            <th className="px-3 py-2 text-right font-medium text-[rgb(var(--color-text-500))]">{t('deferredRevenue.table.opening', { defaultValue: 'Opening' })}</th>
            <th className="px-3 py-2 text-right font-medium text-[rgb(var(--color-text-500))]">{t('deferredRevenue.table.issued', { defaultValue: 'Issued' })}</th>
            <th className="px-3 py-2 text-right font-medium text-[rgb(var(--color-text-500))]">{t('deferredRevenue.table.applied', { defaultValue: 'Applied' })}</th>
            <th className="px-3 py-2 text-right font-medium text-[rgb(var(--color-text-500))]">{t('deferredRevenue.table.expired', { defaultValue: 'Expired' })}</th>
            <th className="px-3 py-2 text-right font-medium text-[rgb(var(--color-text-500))]">{t('deferredRevenue.table.closing', { defaultValue: 'Closing' })}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[rgb(var(--color-border-200))]">
          {section.clients.length === 0 ? (
            <tr>
              <td colSpan={13} className="px-4 py-5 text-center text-[rgb(var(--color-text-500))]">
                {t('deferredRevenue.table.noClients', { defaultValue: 'No clients with prepaid balances this month.' })}
              </td>
            </tr>
          ) : (
            section.clients.map((client) => {
              const key = clientExpansionKey(client);
              const expanded = expandedClients.has(key);
              return (
                <ClientRow
                  key={key}
                  client={client}
                  currency={currency}
                  expanded={expanded}
                  onToggle={() => toggleClient(key)}
                  formatCurrency={formatCurrency}
                />
              );
            })
          )}
          <tr className="bg-[rgb(var(--color-background-100))]">
            <td className="px-4 py-3 font-semibold text-[rgb(var(--color-text-900))]">
              {t('deferredRevenue.table.tenantTotal', { defaultValue: 'Tenant total' })}
            </td>
            <MovementCells movement={section.totals.credits} currency={currency} showAdjustments formatCurrency={formatCurrency} className="font-medium text-[rgb(var(--color-text-900))]" />
            <MovementCells movement={section.totals.hours} currency={currency} showAdjustments={false} formatCurrency={formatCurrency} className="font-medium text-[rgb(var(--color-text-900))]" />
            <td className="px-3 py-3 text-right font-semibold tabular-nums text-[rgb(var(--color-text-900))]">
              {formatCents(section.totals.total.closing, currency, formatCurrency)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ClientRow({
  client,
  currency,
  expanded,
  onToggle,
  formatCurrency,
}: {
  client: CurrencySection['clients'][number];
  currency: string;
  expanded: boolean;
  onToggle: () => void;
  formatCurrency: (value: number, currency: string) => string;
}) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-[rgb(var(--color-background-50))]" onClick={onToggle}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-[rgb(var(--color-text-500))]" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-[rgb(var(--color-text-500))]" />
            )}
            <span className="font-medium text-[rgb(var(--color-text-900))]">{client.clientName}</span>
          </div>
        </td>
        <MovementCells movement={client.credits} currency={currency} showAdjustments formatCurrency={formatCurrency} />
        <MovementCells movement={client.hours} currency={currency} showAdjustments={false} formatCurrency={formatCurrency} />
        <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-[rgb(var(--color-text-900))]">
          {formatCents(client.total.closing, currency, formatCurrency)}
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={13} className="border-t border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background-50))] p-0">
            <div className="divide-y divide-[rgb(var(--color-border-200))]">
              <CreditDetailList details={client.creditDetails} currency={currency} formatCurrency={formatCurrency} />
              <BucketDetailList details={client.bucketDetails} currency={currency} formatCurrency={formatCurrency} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function DeferredRevenueReport() {
  const { t } = useTranslation('msp/reports');
  const { formatCurrency } = useFormatters();
  const [month, setMonth] = useState<string>(() => defaultReportMonth());
  const [report, setReport] = useState<DeferredRevenueReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    getDeferredRevenueReport({ month })
      .then((data) => {
        if (isReportActionError(data)) {
          if (!cancelled) setError(getErrorMessage(data));
          return;
        }
        if (!cancelled) setReport(data);
      })
      .catch((err) => {
        console.error('Failed to load deferred revenue report:', err);
        if (!cancelled) {
          setError(t('deferredRevenue.errors.load', { defaultValue: 'Failed to load the deferred revenue report.' }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [month, t]);

  const toggleClient = useCallback((key: string) => {
    setExpandedClients((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const csvRows: ClientCsvRow[] = useMemo(() => {
    if (!report) return [];
    return report.sections.flatMap((section) =>
      section.clients.map((client) => ({
        clientId: client.clientId,
        clientName: client.clientName,
        currencyCode: client.currencyCode,
        credits: client.credits,
        hours: client.hours,
        total: client.total,
      })),
    );
  }, [report]);

  const csvColumns: CsvColumn[] = useMemo(() => {
    const columns: CsvColumn[] = [
      { key: 'client', header: t('deferredRevenue.csv.client', { defaultValue: 'Client' }), value: (row) => row.clientName },
      { key: 'currency', header: t('deferredRevenue.csv.currency', { defaultValue: 'Currency' }), value: (row) => row.currencyCode },
    ];
    for (const label of ['credits.opening', 'credits.issued', 'credits.applied', 'credits.expired', 'credits.adjustments', 'credits.closing'] as const) {
      columns.push({ key: label, header: label, value: (row) => row.credits[label.split('.')[1] as keyof MovementColumns] });
    }
    for (const label of ['hours.opening', 'hours.issued', 'hours.applied', 'hours.expired', 'hours.closing'] as const) {
      columns.push({ key: label, header: label, value: (row) => row.hours[label.split('.')[1] as keyof MovementColumns] });
    }
    columns.push({ key: 'total.closing', header: 'total.closing', value: (row) => row.total.closing });
    return columns;
  }, [t]);

  const printColumns: PrintableTableColumn<ClientCsvRow>[] = useMemo(() => {
    const label = (key: string, fallback: string) =>
      t(`deferredRevenue.table.${key}`, { defaultValue: fallback });
    const cells = (movement: MovementColumns, showAdjustments: boolean) => {
      const defs: Array<[string, number]> = [
        [label('opening', 'Opening'), movement.opening],
        [label('issued', 'Issued'), movement.issued],
        [label('applied', 'Applied'), movement.applied],
        [label('expired', 'Expired'), movement.expired],
      ];
      if (showAdjustments) defs.push([label('adjustments', 'Adjustments'), movement.adjustments]);
      defs.push([label('closing', 'Closing'), movement.closing]);
      return defs;
    };
    const creditCells = cells({} as MovementColumns, true).map(([label]) => label);
    const hourCells = cells({} as MovementColumns, false).map(([label]) => label);
    return [
      { key: 'client', header: label('client', 'Client'), render: (row) => row.clientName },
      { key: 'currency', header: t('deferredRevenue.csv.currency', { defaultValue: 'Currency' }), render: (row) => row.currencyCode },
      ...creditCells.map((header, index): PrintableTableColumn<ClientCsvRow> => ({
        key: `credits.${header}`,
        header: `Credits ${header}`,
        render: (row) => {
          const movement = row.credits;
          const value = index === 0 ? movement.opening : index === 1 ? movement.issued : index === 2 ? movement.applied : index === 3 ? movement.expired : index === 4 ? movement.adjustments : movement.closing;
          return formatCents(value, row.currencyCode, formatCurrency);
        },
      })),
      ...hourCells.map((header, index): PrintableTableColumn<ClientCsvRow> => ({
        key: `hours.${header}`,
        header: `Hours ${header}`,
        render: (row) => {
          const movement = row.hours;
          const value = index === 0 ? movement.opening : index === 1 ? movement.issued : index === 2 ? movement.applied : index === 3 ? movement.expired : movement.closing;
          return formatCents(value, row.currencyCode, formatCurrency);
        },
      })),
      { key: 'total', header: label('total', 'Total closing'), render: (row) => formatCents(row.total.closing, row.currencyCode, formatCurrency) },
    ];
  }, [formatCurrency, t]);

  const handleCsvDownload = useCallback(() => {
    const filename = `deferred-revenue-${month}.csv`;
    downloadCsv(filename, csvColumns.map((column) => column.header), csvRows, csvColumns);
  }, [csvColumns, csvRows, month]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
            {t('deferredRevenue.title', { defaultValue: 'Deferred revenue / prepaid liability' })}
          </h2>
          <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
            {t('deferredRevenue.description', {
              defaultValue: 'Per-client, per-month rollforward of client credit balances and unburned prepaid bucket hours.',
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="deferred-revenue-month"
            type="month"
            value={month}
            onChange={(event) => {
              if (event.target.value) setMonth(event.target.value);
            }}
            className="h-9 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-3 text-sm text-[rgb(var(--color-text-900))]"
          />
          <Button id="deferred-revenue-csv" size="sm" variant="outline" onClick={handleCsvDownload} disabled={csvRows.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            {t('deferredRevenue.actions.csv', { defaultValue: 'Download CSV' })}
          </Button>
          <PrintButton id="deferred-revenue-print" size="sm" variant="outline" />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-[rgb(var(--color-destructive-600))]">{error}</p>
      ) : !report ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
          <Skeleton className="h-72" />
        </div>
      ) : (
        <>
          {report.notes.length > 0 ? (
            <p className="text-xs text-[rgb(var(--color-text-500))]">
              {report.notes.join(' ')}
            </p>
          ) : null}
          {report.sections.length === 0 ? (
            <p className="rounded-md border border-[rgb(var(--color-border-200))] px-4 py-6 text-sm text-[rgb(var(--color-text-500))]">
              {t('deferredRevenue.empty', { defaultValue: 'No prepaid liability for this month.' })}
            </p>
          ) : (
            <>
              <SummaryCards sections={report.sections} formatCurrency={formatCurrency} />
              {report.sections.map((section) => (
                <section key={section.currencyCode} aria-label={`${section.currencyCode} rollforward`}>
                  <h3 className="mb-2 text-sm font-semibold text-[rgb(var(--color-text-900))]">
                    {t('deferredRevenue.table.currencyHeading', { defaultValue: 'Currency' })}: {section.currencyCode}
                  </h3>
                  <DeferredRevenueTable
                    section={section}
                    expandedClients={expandedClients}
                    toggleClient={toggleClient}
                    formatCurrency={formatCurrency}
                  />
                </section>
              ))}
            </>
          )}
        </>
      )}

      <div className="app-print-root app-print-only">
        <header className="app-print-detail-header">
          <h1>{t('deferredRevenue.title', { defaultValue: 'Deferred revenue / prepaid liability' })}</h1>
          <p className="app-print-detail-subtitle">
            {t('deferredRevenue.printSubtitle', { defaultValue: 'Month {{month}}', month })}
          </p>
        </header>
        {report ? (
          <>
            <section className="app-print-table-section" style={{ marginBottom: '10pt' }}>
              <table className="app-print-table" style={{ tableLayout: 'fixed' }}>
                <tbody>
                  <tr>
                    {report.sections.map((section) => (
                      <td key={section.currencyCode} style={{ verticalAlign: 'top' }}>
                        <div style={{ fontSize: '8pt', color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {t('deferredRevenue.summary.totalLiability', { defaultValue: 'Total prepaid liability' })} · {section.currencyCode}
                        </div>
                        <div style={{ fontSize: '15pt', fontWeight: 700, marginTop: '2pt' }}>
                          {formatCents(section.totals.total.closing, section.currencyCode, formatCurrency)}
                        </div>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </section>
            <PrintableTable
              title={t('deferredRevenue.printTable', { defaultValue: 'Per-client rollforward' })}
              subtitle={month}
              rows={csvRows}
              columns={printColumns}
              getRowKey={(row) => `${row.clientId}-${row.currencyCode}`}
              emptyMessage={t('deferredRevenue.empty', { defaultValue: 'No prepaid liability for this month.' })}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
