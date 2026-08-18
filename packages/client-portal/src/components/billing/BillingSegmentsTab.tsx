'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from '@alga-psa/ui/components/Card';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Label } from '@alga-psa/ui/components/Label';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getPortalChargesForBillingProfile,
  getPortalSpendByBillingProfile,
  type PortalSegmentChargeRow,
  type PortalSegmentSpend,
} from '../../actions/client-portal-actions/client-billing-segments';

/**
 * Organisation-wide spend with a per-segment breakdown (F071, F072, F073).
 *
 * The whole point of the portal side of this feature is that a manager over
 * several separately-billed entities gets *both* views from one login: the
 * organisation total, and which part of it belongs to which entity. So the
 * total and the breakdown are shown together, from one query, rather than as
 * two screens the reader has to reconcile.
 *
 * The tab is not rendered at all for a client with one profile — see
 * `BillingOverview`, which only adds it when the segment list has more than one
 * entry (F077).
 */

const ALL_SEGMENTS = '__all__';

interface BillingSegmentsTabProps {
  formatCurrency: (amount: number, currencyCode?: string) => string;
  formatDate: (value: string) => string;
}

function lastTwelveMonths(): { start: string; end: string } {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const start = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth() + 1, 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export function BillingSegmentsTab({ formatCurrency, formatDate }: BillingSegmentsTabProps) {
  const { t } = useTranslation('client-portal');
  const [period] = useState(() => lastTwelveMonths());
  const [spend, setSpend] = useState<PortalSegmentSpend | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSegment, setSelectedSegment] = useState<string>(ALL_SEGMENTS);
  const [charges, setCharges] = useState<PortalSegmentChargeRow[]>([]);
  const [chargesLoading, setChargesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      try {
        const result = await getPortalSpendByBillingProfile({
          periodStart: period.start,
          periodEnd: period.end,
        });
        if (!cancelled && !('actionError' in (result as any)) && !('permissionError' in (result as any))) {
          setSpend(result as PortalSegmentSpend);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period]);

  const loadCharges = useCallback(
    async (billingProfileId: string) => {
      setChargesLoading(true);
      try {
        const result = await getPortalChargesForBillingProfile({
          billingProfileId,
          periodStart: period.start,
          periodEnd: period.end,
        });
        setCharges(Array.isArray(result) ? result : []);
      } finally {
        setChargesLoading(false);
      }
    },
    [period],
  );

  useEffect(() => {
    if (selectedSegment === ALL_SEGMENTS) {
      setCharges([]);
      return;
    }
    void loadCharges(selectedSegment);
  }, [selectedSegment, loadCharges]);

  const currency = spend?.currencyCode ?? 'USD';
  const money = (cents: number) => formatCurrency(cents / 100, currency);

  const options = useMemo(
    () => [
      {
        value: ALL_SEGMENTS,
        label: t('billing.segments.allSegments', { defaultValue: 'Whole organisation' }),
      },
      ...(spend?.rows ?? []).map((row) => ({
        value: row.billingProfileId,
        label: row.name,
      })),
    ],
    [spend, t],
  );

  const visibleRows = useMemo(() => {
    if (!spend) return [];
    if (selectedSegment === ALL_SEGMENTS) return spend.rows;
    return spend.rows.filter((row) => row.billingProfileId === selectedSegment);
  }, [spend, selectedSegment]);

  if (isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-gray-500">
              {t('billing.segments.organizationTotalLabel', {
                defaultValue: 'Total across your organisation',
              })}
            </p>
            <p className="text-2xl font-semibold">{money(spend?.organizationTotal ?? 0)}</p>
            <p className="text-xs text-gray-500">
              {t('billing.segments.periodLabel', {
                start: formatDate(period.start),
                end: formatDate(period.end),
                defaultValue: '{{start}} to {{end}}',
              })}
            </p>
          </div>
          <div className="w-64">
            <Label htmlFor="portal-segment-select">
              {t('billing.segments.selectorLabel', { defaultValue: 'Show' })}
            </Label>
            <CustomSelect
              id="portal-segment-select"
              value={selectedSegment}
              onValueChange={setSelectedSegment}
              options={options}
            />
          </div>
        </div>

        {visibleRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            {t('billing.segments.empty', {
              defaultValue: 'No billed charges in this period.',
            })}
          </p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {visibleRows.map((row) => {
              const isOpen = selectedSegment === row.billingProfileId;
              const share =
                spend && spend.organizationTotal > 0
                  ? Math.round((row.total / spend.organizationTotal) * 100)
                  : null;
              return (
                <li key={row.billingProfileId} className="py-3">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 text-left"
                    onClick={() =>
                      setSelectedSegment(isOpen ? ALL_SEGMENTS : row.billingProfileId)
                    }
                  >
                    <span className="flex items-center gap-1 font-medium">
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      {row.name}
                    </span>
                    <span className="text-right">
                      <span className="block font-medium">{money(row.total)}</span>
                      {share !== null && (
                        <span className="block text-xs text-gray-500">{share}%</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {selectedSegment !== ALL_SEGMENTS && (
        <Card className="p-6">
          <h4 className="mb-2 text-sm font-medium">
            {t('billing.segments.chargesTitle', { defaultValue: 'Charges in this segment' })}
          </h4>
          {chargesLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : charges.length === 0 ? (
            <p className="text-sm text-gray-500">
              {t('billing.segments.noCharges', { defaultValue: 'No charges in this period.' })}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {charges.map((charge) => (
                <li key={charge.itemId} className="flex items-baseline justify-between gap-4 py-2">
                  <div className="min-w-0">
                    <div className="truncate">{charge.description}</div>
                    <div className="text-xs text-gray-500">
                      {charge.invoiceNumber}
                      {charge.invoiceDate ? ` · ${formatDate(charge.invoiceDate)}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 font-medium">{money(charge.netAmount)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

export default BillingSegmentsTab;
