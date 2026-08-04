'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Badge } from '@alga-psa/ui/components/Badge';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import type { ColumnDefinition, IForecastBand, IForecastDealContribution } from '@alga-psa/types';
import { getForecastBand } from '@enterprise/lib/opportunities/actions';

type PeriodKey = 'current' | 'next';

/** Quarter boundaries, `offset` quarters from the one we are standing in. */
function quarterPeriod(offset = 0): { start: string; end: string; label: string } {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + offset;
  const start = new Date(now.getFullYear(), q * 3, 1);
  const end = new Date(now.getFullYear(), q * 3 + 3, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    label: `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`,
  };
}

/**
 * The forecast is a band, never a number. The floor is signed-plus-verbal;
 * the ceiling is evidence-weighted — calibrated per seller once their
 * history has earned it.
 */
export function OpportunityForecastView() {
  const { t } = useTranslation('msp/opportunities');
  const [band, setBand] = useState<IForecastBand | null>(null);
  const [period, setPeriod] = useState<PeriodKey>('current');
  const [currency, setCurrency] = useState('all');
  const [pageSize, setPageSize] = useState(25);
  const quarter = quarterPeriod(period === 'next' ? 1 : 0);

  const load = useCallback(async (key: PeriodKey) => {
    setBand(null);
    try {
      const { start, end } = quarterPeriod(key === 'next' ? 1 : 0);
      setBand(await getForecastBand({ start, end }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const fmt = (cents: number, currencyCode: string) => formatCurrencyFromMinorUnits(cents, undefined, currencyCode);

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
      title: t('opportunities.forecast.basis', 'Why it is counted'),
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
      title: t('opportunities.forecast.currency', 'Currency'),
      dataIndex: 'currency_code',
      render: (_v, r) => <span className="font-mono text-xs">{r.currency_code}</span>,
    },
    {
      title: <span className="text-right">{t('opportunities.forecast.floorCol', 'Floor')}</span>,
      dataIndex: 'floor_mrr_cents',
      render: (_v, r) => (
        <span className="block text-right tabular-nums">
          {fmt(r.floor_mrr_cents, r.currency_code)}{t('opportunities.perMonthSuffix', '/mo')}
        </span>
      ),
    },
  ];

  const currencyCodes = band?.by_currency.map((entry) => entry.currency_code) ?? [];
  const visibleBands = (band?.by_currency ?? []).filter(
    (entry) => currency === 'all' || entry.currency_code === currency,
  );
  const visibleComposition = (band?.composition ?? []).filter(
    (entry) => currency === 'all' || entry.currency_code === currency,
  );

  return (
    <div id="opportunities-forecast" className="mx-auto w-full max-w-3xl space-y-5">
      <div>
        <p className="text-sm text-[rgb(var(--color-text-600))]">
          {t(
            'opportunities.forecast.intro',
            'What this quarter is worth if nothing else changes. The floor counts only deals that are signed or verbally agreed. The ceiling weights every open deal by the evidence behind its stage. Expect the result to land between the two.'
          )}
        </p>
        <p className="mt-1 text-[12px] text-[rgb(var(--color-text-400))]">
          {t(
            'opportunities.forecast.currencyNote',
            'One section per currency your open deals are priced in. Amounts in different currencies are never added together.'
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <CustomSelect
          id="opportunities-forecast-period"
          label={t('opportunities.forecast.period', 'Period')}
          className="w-52"
          options={[
            { value: 'current', label: t('opportunities.forecast.thisQuarter', 'This quarter ({{q}})', { q: quarterPeriod(0).label }) },
            { value: 'next', label: t('opportunities.forecast.nextQuarter', 'Next quarter ({{q}})', { q: quarterPeriod(1).label }) },
          ]}
          value={period}
          onValueChange={(value: string) => setPeriod(value as PeriodKey)}
        />
        <CustomSelect
          id="opportunities-forecast-currency"
          label={t('opportunities.forecast.currency', 'Currency')}
          className="w-44"
          options={[
            { value: 'all', label: t('opportunities.forecast.allCurrencies', 'All currencies') },
            ...currencyCodes.map((code) => ({ value: code, label: code })),
          ]}
          value={currency}
          onValueChange={setCurrency}
          disabled={currencyCodes.length === 0}
        />
      </div>

      {!band ? <Skeleton className="h-56 w-full" /> : null}

      {band && visibleBands.length === 0 ? (
        <p className="text-sm text-[rgb(var(--color-text-500))]">
          {t('opportunities.forecast.empty', 'No deals land in {{q}} yet.', { q: quarter.label })}
        </p>
      ) : null}

      {visibleBands.map((currencyBand) => (
        <div key={currencyBand.currency_code} className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
            {currencyBand.currency_code}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-white p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
                {t('opportunities.forecast.floor', 'Floor (signed and verbal)')}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-[rgb(var(--color-text-900))]">
                {fmt(currencyBand.floor_mrr_cents, currencyBand.currency_code)}
                <span className="text-sm font-medium text-[rgb(var(--color-text-400))]">
                  {t('opportunities.perMonthSuffix', '/mo')}
                </span>
              </div>
              <div className="text-sm tabular-nums text-[rgb(var(--color-text-500))]">
                {t('opportunities.forecast.plusOneTime', '+ {{amount}} one-time', {
                  amount: fmt(currencyBand.floor_nrr_cents, currencyBand.currency_code),
                })}
              </div>
            </div>
            <div className="rounded-xl border border-[rgb(var(--color-primary-200))] bg-[rgb(var(--color-primary-50))] p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--color-primary-600))]">
                {t('opportunities.forecast.ceiling', 'Ceiling (evidence-weighted)')}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-[rgb(var(--color-text-900))]">
                {fmt(currencyBand.ceiling_mrr_cents, currencyBand.currency_code)}
                <span className="text-sm font-medium text-[rgb(var(--color-text-400))]">
                  {t('opportunities.perMonthSuffix', '/mo')}
                </span>
              </div>
              <div className="text-sm tabular-nums text-[rgb(var(--color-text-500))]">
                {t('opportunities.forecast.plusOneTime', '+ {{amount}} one-time', {
                  amount: fmt(currencyBand.ceiling_nrr_cents, currencyBand.currency_code),
                })}
              </div>
            </div>
          </div>
        </div>
      ))}
      <p className="text-[12px] text-[rgb(var(--color-text-400))]">
        {t(
          'opportunities.forecast.note',
          'Weights start from the evidence behind each stage. Once an owner has twenty closed deals on record, their own close rates replace the defaults.'
        )}
      </p>
      {band ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-[rgb(var(--color-text-900))]">
            {t('opportunities.forecast.composition', 'Deals counted in this forecast')}
          </h3>
          <DataTable
            id="opportunities-forecast-composition"
            data={visibleComposition}
            columns={columns}
            pageSize={pageSize}
            onItemsPerPageChange={setPageSize}
          />
        </div>
      ) : null}
    </div>
  );
}
