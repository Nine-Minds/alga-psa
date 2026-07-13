'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Badge } from '@alga-psa/ui/components/Badge';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import type { ColumnDefinition, IForecastBand, IForecastDealContribution } from '@alga-psa/types';
import { getForecastBand } from '@enterprise/lib/opportunities/actions';

function quarterPeriod(): { start: string; end: string } {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3);
  const start = new Date(now.getFullYear(), q * 3, 1);
  const end = new Date(now.getFullYear(), q * 3 + 3, 0);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * The forecast is a band, never a number. The floor is signed-plus-verbal;
 * the ceiling is evidence-weighted — calibrated per seller once their
 * history has earned it.
 */
export function OpportunityForecastView({ currencyCode }: { currencyCode: string }) {
  const { t } = useTranslation();
  const [band, setBand] = useState<IForecastBand | null>(null);

  const load = useCallback(async () => {
    try {
      setBand(await getForecastBand(quarterPeriod()));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!band) return <Skeleton className="h-56 w-full" />;

  const fmt = (cents: number) => formatCurrencyFromMinorUnits(cents, undefined, currencyCode);

  const columns: ColumnDefinition<IForecastDealContribution>[] = [
    {
      title: t('opportunities.forecast.deal', 'Deal'),
      dataIndex: 'title',
      render: (_v, r) => (
        <div>
          <div className="font-medium text-[rgb(var(--color-text-900))]">{r.title}</div>
          <div className="font-mono text-[11px] text-[rgb(var(--color-text-400))]">{r.opportunity_number}</div>
        </div>
      ),
    },
    {
      title: t('opportunities.forecast.basis', 'Counted because'),
      dataIndex: 'weight_source',
      render: (_v, r) =>
        r.weight_source === 'won' ? (
          <Badge variant="success" size="sm">{t('opportunities.forecast.won', 'Won this period')}</Badge>
        ) : (
          <span className="text-sm text-[rgb(var(--color-text-700))]">
            {t('opportunities.forecast.weighted', '{{stage}} · weighted {{pct}}%', {
              stage: r.stage,
              pct: Math.round(r.weight * 100),
            })}
            {r.weight_source === 'seller_calibration' ? (
              <span className="ml-1.5 text-[11px] text-[rgb(var(--color-primary-600))]">
                {t('opportunities.forecast.calibrated', 'calibrated')}
              </span>
            ) : null}
          </span>
        ),
    },
    {
      title: <span className="text-right">{t('opportunities.forecast.floorCol', 'Floor')}</span>,
      dataIndex: 'floor_mrr_cents',
      render: (_v, r) => (
        <span className="block text-right tabular-nums">
          {fmt(r.floor_mrr_cents)}{t('opportunities.perMonthSuffix', '/mo')}
        </span>
      ),
    },
  ];

  return (
    <div id="opportunities-forecast" className="mx-auto w-full max-w-3xl space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-white p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
            {t('opportunities.forecast.floor', 'Floor — signed and verbal')}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-[rgb(var(--color-text-900))]">
            {fmt(band.floor_mrr_cents)}
            <span className="text-sm font-medium text-[rgb(var(--color-text-400))]">
              {t('opportunities.perMonthSuffix', '/mo')}
            </span>
          </div>
          <div className="text-sm tabular-nums text-[rgb(var(--color-text-500))]">
            {t('opportunities.forecast.plusOneTime', '+ {{amount}} one-time', { amount: fmt(band.floor_nrr_cents) })}
          </div>
        </div>
        <div className="rounded-xl border border-[rgb(var(--color-primary-200))] bg-[rgb(var(--color-primary-50))] p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--color-primary-600))]">
            {t('opportunities.forecast.ceiling', 'Ceiling — evidence-weighted')}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-[rgb(var(--color-text-900))]">
            {fmt(band.ceiling_mrr_cents)}
            <span className="text-sm font-medium text-[rgb(var(--color-text-400))]">
              {t('opportunities.perMonthSuffix', '/mo')}
            </span>
          </div>
          <div className="text-sm tabular-nums text-[rgb(var(--color-text-500))]">
            {t('opportunities.forecast.plusOneTime', '+ {{amount}} one-time', { amount: fmt(band.ceiling_nrr_cents) })}
          </div>
        </div>
      </div>
      <p className="text-[12px] text-[rgb(var(--color-text-400))]">
        {t(
          'opportunities.forecast.note',
          'This quarter. Weights come from evidence stages, replaced by each seller’s own close rates once they have twenty closed deals of history.'
        )}
      </p>
      <DataTable id="opportunities-forecast-composition" data={band.composition} columns={columns} />
    </div>
  );
}
