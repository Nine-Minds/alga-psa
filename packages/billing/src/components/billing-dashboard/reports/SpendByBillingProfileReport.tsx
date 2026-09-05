'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Download, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { dateFromString, dateToString } from '@alga-psa/ui/lib/dateInput';
import { Label } from '@alga-psa/ui/components/Label';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useClientBillingProfiles } from '@alga-psa/ui/hooks/useClientBillingProfiles';
import {
  getChargesForBillingProfile,
  getSpendByBillingProfile,
  type SpendByProfileChargeRow,
  type SpendByProfileResult,
  type SpendByProfileRow,
} from '@alga-psa/billing/actions/billingProfileReportActions';
import { getClientBillingProfilesForBilling } from '@alga-psa/billing/actions/billingProfileActions';
import { billingProfileSourceSentence } from '@alga-psa/ui/lib/billingProfileAttributionCopy';

/**
 * Spend by billing profile (F053–F060).
 *
 * Answers "what does each site cost", and lets the number be opened rather than
 * taken on faith: every total drills into exactly the charges that were summed
 * (F054).
 *
 * The report renders nothing at all for a single-profile client (F058). That is
 * the same invisibility rule the pickers follow — a client with one profile has
 * no segments to compare, so a report showing one row with 100% of spend is
 * noise dressed as insight.
 */

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

const loadBillingProfiles = (clientId: string) => getClientBillingProfilesForBilling(clientId);

interface SpendByBillingProfileReportProps {
  clientId: string;
}

/** The month before the current one, as an inclusive-start/exclusive-end range. */
function lastCompleteMonth(today = new Date()): { start: string; end: string } {
  const startOfThisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const startOfLastMonth = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1),
  );
  return {
    start: startOfLastMonth.toISOString().slice(0, 10),
    end: startOfThisMonth.toISOString().slice(0, 10),
  };
}

/** The equally long window immediately before `range` — the natural comparison. */
function precedingWindow(range: { start: string; end: string }): { start: string; end: string } {
  const start = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);
  const lengthMs = end.getTime() - start.getTime();
  return {
    start: new Date(start.getTime() - lengthMs).toISOString().slice(0, 10),
    end: range.start,
  };
}

function toCsv(rows: string[][]): string {
  const escape = (cell: string) =>
    /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
  return rows.map((row) => row.map(escape).join(',')).join('\n');
}

export function SpendByBillingProfileReport({ clientId }: SpendByBillingProfileReportProps) {
  const { t } = useTranslation('msp/billing');
  const { formatCurrency } = useFormatters();
  const { isSegmented, isLoading: profilesLoading } = useClientBillingProfiles(
    clientId,
    loadBillingProfiles,
  );

  const [range, setRange] = useState(() => lastCompleteMonth());
  const [compare, setCompare] = useState(false);
  const [result, setResult] = useState<SpendByProfileResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);
  const [charges, setCharges] = useState<SpendByProfileChargeRow[]>([]);
  const [chargesLoading, setChargesLoading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const comparison = compare ? precedingWindow(range) : null;
      const response = await getSpendByBillingProfile({
        clientId,
        periodStart: range.start,
        periodEnd: range.end,
        comparisonPeriodStart: comparison?.start ?? null,
        comparisonPeriodEnd: comparison?.end ?? null,
      });
      if (isReturnedActionError(response)) {
        setError(getErrorMessage(response));
        setResult(null);
        return;
      }
      setResult(response);
    } finally {
      setIsLoading(false);
    }
  }, [clientId, compare, range]);

  useEffect(() => {
    if (isSegmented) void load();
  }, [isSegmented, load]);

  const openDrillDown = useCallback(
    async (billingProfileId: string) => {
      if (expandedProfileId === billingProfileId) {
        setExpandedProfileId(null);
        return;
      }
      setExpandedProfileId(billingProfileId);
      setChargesLoading(true);
      try {
        const response = await getChargesForBillingProfile({
          clientId,
          billingProfileId,
          periodStart: range.start,
          periodEnd: range.end,
        });
        setCharges(isReturnedActionError(response) ? [] : response);
      } finally {
        setChargesLoading(false);
      }
    },
    [clientId, expandedProfileId, range],
  );

  const comparisonByProfileId = useMemo(() => {
    const map = new Map<string, SpendByProfileRow>();
    for (const row of result?.comparison?.rows ?? []) {
      map.set(row.billingProfileId, row);
    }
    return map;
  }, [result]);

  const currency = result?.currencyCode ?? 'USD';
  const money = (cents: number) => formatCurrency(cents / 100, currency);

  const grandTotal = (result?.rows ?? []).reduce((sum, row) => sum + row.total, 0);

  const handleExport = () => {
    if (!result) return;
    const header = [
      t('spendByProfile.columns.profile', { defaultValue: 'Billing profile' }),
      t('spendByProfile.columns.charges', { defaultValue: 'Charges' }),
      t('spendByProfile.columns.net', { defaultValue: 'Net' }),
      t('spendByProfile.columns.tax', { defaultValue: 'Tax' }),
      t('spendByProfile.columns.total', { defaultValue: 'Total' }),
      t('spendByProfile.columns.unattributed', { defaultValue: 'Unattributed (fell back to default)' }),
    ];
    if (result.comparison) {
      header.push(t('spendByProfile.columns.priorTotal', { defaultValue: 'Prior period total' }));
    }
    const body = result.rows.map((row) => {
      const cells = [
        row.profileName,
        String(row.chargeCount),
        (row.netAmount / 100).toFixed(2),
        (row.taxAmount / 100).toFixed(2),
        (row.total / 100).toFixed(2),
        (row.clientDefaultFallbackAmount / 100).toFixed(2),
      ];
      if (result.comparison) {
        cells.push(((comparisonByProfileId.get(row.billingProfileId)?.total ?? 0) / 100).toFixed(2));
      }
      return cells;
    });

    const blob = new Blob([toCsv([header, ...body])], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `spend-by-billing-profile-${range.start}-to-${range.end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const columns: ColumnDefinition<SpendByProfileRow>[] = [
    {
      title: t('spendByProfile.columns.profile', { defaultValue: 'Billing profile' }),
      dataIndex: 'profileName',
      render: (_value, row) => (
        <button
          type="button"
          className="flex items-center gap-1 text-left font-medium hover:underline"
          onClick={() => void openDrillDown(row.billingProfileId)}
        >
          {expandedProfileId === row.billingProfileId ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          {row.profileName}
          {row.isDefaultProfile && (
            <Badge variant="default-muted">
              {t('spendByProfile.defaultBadge', { defaultValue: 'Default' })}
            </Badge>
          )}
        </button>
      ),
    },
    {
      title: t('spendByProfile.columns.charges', { defaultValue: 'Charges' }),
      dataIndex: 'chargeCount',
      render: (value) => String(value),
    },
    {
      title: t('spendByProfile.columns.net', { defaultValue: 'Net' }),
      dataIndex: 'netAmount',
      render: (value) => money(Number(value)),
    },
    {
      title: t('spendByProfile.columns.tax', { defaultValue: 'Tax' }),
      dataIndex: 'taxAmount',
      render: (value) => money(Number(value)),
    },
    {
      title: t('spendByProfile.columns.total', { defaultValue: 'Total' }),
      dataIndex: 'total',
      render: (value, row) => (
        <div>
          <div className="font-medium">{money(Number(value))}</div>
          {grandTotal > 0 && (
            <div className="text-xs text-gray-500">
              {Math.round((row.total / grandTotal) * 100)}%
            </div>
          )}
        </div>
      ),
    },
    {
      // F059 — a number attributed only because nothing claimed it is a
      // different kind of number from one a contract placed deliberately.
      title: t('spendByProfile.columns.unattributed', {
        defaultValue: 'Fell back to default',
      }),
      dataIndex: 'clientDefaultFallbackAmount',
      render: (value) =>
        Number(value) === 0 ? (
          <span className="text-gray-400">—</span>
        ) : (
          <span title={t('spendByProfile.unattributedHint', {
            defaultValue:
              'No contract, contract line, or work item claimed these charges, so they landed on the default profile.',
          })}>
            {money(Number(value))}
          </span>
        ),
    },
    ...(result?.comparison
      ? [
          {
            title: t('spendByProfile.columns.change', { defaultValue: 'Change' }),
            dataIndex: 'billingProfileId',
            render: (_value: unknown, row: SpendByProfileRow) => {
              const prior = comparisonByProfileId.get(row.billingProfileId)?.total ?? 0;
              const delta = row.total - prior;
              if (prior === 0 && delta === 0) return <span className="text-gray-400">—</span>;
              const sign = delta > 0 ? '+' : '';
              return (
                <div>
                  <div className={delta > 0 ? 'text-amber-700' : delta < 0 ? 'text-green-700' : ''}>
                    {sign}
                    {money(delta)}
                  </div>
                  <div className="text-xs text-gray-500">
                    {t('spendByProfile.priorPeriod', { defaultValue: 'was {{amount}}', amount: money(prior) })}
                  </div>
                </div>
              );
            },
          } as ColumnDefinition<SpendByProfileRow>,
        ]
      : []),
  ];

  // F058 — no report for a client that has nothing to compare.
  if (profilesLoading || !isSegmented) {
    return null;
  }

  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">
            {t('spendByProfile.title', { defaultValue: 'Spend by billing profile' })}
          </h3>
          <p className="text-sm text-gray-500">
            {t('spendByProfile.description', {
              defaultValue:
                'What each site or entity within this client cost over the period. Open a row to see the charges behind the number.',
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="spend-by-profile-start">
              {t('spendByProfile.from', { defaultValue: 'From' })}
            </Label>
            <DatePicker
              id="spend-by-profile-start"
              value={dateFromString(range.start)}
              onChange={(next) =>
                setRange((prev) => ({ ...prev, start: dateToString(next) ?? prev.start }))
              }
            />
          </div>
          <div>
            <Label htmlFor="spend-by-profile-end">
              {t('spendByProfile.to', { defaultValue: 'To' })}
            </Label>
            <DatePicker
              id="spend-by-profile-end"
              value={dateFromString(range.end)}
              onChange={(next) =>
                setRange((prev) => ({ ...prev, end: dateToString(next) ?? prev.end }))
              }
            />
          </div>
          <SwitchWithLabel
            label={t('spendByProfile.comparePrevious', { defaultValue: 'Compare to previous period' })}
            checked={compare}
            onCheckedChange={setCompare}
          />
          <Button id="refresh-spend-by-profile" variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-1 h-4 w-4" />
            {t('common.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button
            id="export-spend-by-profile"
            variant="outline"
            disabled={!result || result.rows.length === 0}
            onClick={handleExport}
          >
            <Download className="mr-1 h-4 w-4" />
            {t('common.export', { defaultValue: 'Export' })}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : result && result.rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">
          {t('spendByProfile.empty', {
            defaultValue: 'No finalized charges for this client in the selected period.',
          })}
        </p>
      ) : (
        <DataTable
          id="spend-by-billing-profile-table"
          data={result?.rows ?? []}
          columns={columns}
          pagination={false}
        />
      )}

      {expandedProfileId && (
        <div className="mt-4 rounded-md border border-gray-200 p-4">
          <h4 className="mb-2 text-sm font-medium">
            {t('spendByProfile.drillDownTitle', { defaultValue: 'Charges behind this number' })}
          </h4>
          {chargesLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : charges.length === 0 ? (
            <p className="text-sm text-gray-500">
              {t('spendByProfile.drillDownEmpty', { defaultValue: 'No charges found.' })}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {charges.map((charge) => (
                <li key={charge.itemId} className="flex items-baseline justify-between gap-4 py-2">
                  <div className="min-w-0">
                    <div className="truncate">{charge.description ?? charge.serviceName}</div>
                    <div className="text-xs text-gray-500">
                      {charge.invoiceNumber} · {charge.invoiceDate?.slice(0, 10)}
                      {charge.billingProfileSource
                        ? ` · ${billingProfileSourceSentence(t, charge.billingProfileSource, {
                            profileName: result?.rows.find(
                              (row) => row.billingProfileId === expandedProfileId,
                            )?.profileName,
                            contractName: charge.contractName,
                          })}`
                        : ''}
                    </div>
                  </div>
                  <div className="shrink-0 font-medium">{money(charge.netAmount)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

export default SpendByBillingProfileReport;
