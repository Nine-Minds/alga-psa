'use client';

import { useEffect, useState } from 'react';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import {
  getOpportunityPipelineReport,
  type IOpportunityPipelineReport,
} from '../../actions/reportActions';

/**
 * The one-screen answer to "how much is in the pipeline and what closes soon".
 * Grouped per currency; one-time always means NRR + hardware.
 */
export function OpportunityReportsView({ onOpenForecast }: { onOpenForecast?: () => void }) {
  const { t } = useTranslation('msp/opportunities');
  const [report, setReport] = useState<IOpportunityPipelineReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getOpportunityPipelineReport()
      .then((result) => {
        if (active) setReport(result);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (failed) {
    return (
      <p className="text-sm text-[rgb(var(--color-text-500))]">
        {t('opportunities.reports.unavailable', 'Pipeline totals are temporarily unavailable.')}
      </p>
    );
  }

  if (!report) {
    return (
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-4"
        aria-label={t('opportunities.reports.loading', 'Loading pipeline report')}
      >
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-20 animate-pulse rounded-md bg-[rgb(var(--color-border-100))]" />
        ))}
      </div>
    );
  }

  if (report.by_currency.length === 0) {
    return (
      <EmptyState
        title={t('opportunities.reports.emptyTitle', 'Nothing to report yet')}
        description={t(
          'opportunities.reports.emptyBody',
          'Open a deal and the pipeline totals show up here.'
        )}
      />
    );
  }

  return (
    <div id="opportunities-reports" className="mx-auto w-full max-w-4xl space-y-6">
      {report.by_currency.map((row) => {
        const fmt = (cents: number) => formatCurrencyFromMinorUnits(cents, undefined, row.currency_code);
        return (
          <section key={row.currency_code} className="space-y-3">
            {report.by_currency.length > 1 ? (
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
                {row.currency_code}
              </h3>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile
                id={`opportunity-report-open-${row.currency_code}`}
                label={t('opportunities.reports.openPipeline', 'Open pipeline')}
                primary={`${fmt(row.open_mrr_cents)}${t('opportunities.perMonthSuffix', '/mo')}`}
                secondary={t('opportunities.reports.plusOneTime', '+ {{amount}} one-time', {
                  amount: fmt(row.open_one_time_cents),
                })}
                note={t('opportunities.reports.openCount', '{{n}} open', { n: row.open_count })}
              />
              <Tile
                id={`opportunity-report-weighted-${row.currency_code}`}
                label={t('opportunities.reports.weighted', 'Weighted forecast')}
                primary={`${fmt(row.weighted_mrr_cents)}${t('opportunities.perMonthSuffix', '/mo')}`}
                secondary={t('opportunities.reports.plusOneTime', '+ {{amount}} one-time', {
                  amount: fmt(row.weighted_one_time_cents),
                })}
                note={t('opportunities.reports.weightedNote', 'Stage base rates')}
              />
              <Tile
                id={`opportunity-report-closing-${row.currency_code}`}
                label={t('opportunities.reports.closing30', 'Closing in 30 days')}
                primary={`${fmt(row.closing_30d_mrr_cents)}${t('opportunities.perMonthSuffix', '/mo')}`}
                secondary={t('opportunities.reports.plusOneTime', '+ {{amount}} one-time', {
                  amount: fmt(row.closing_30d_one_time_cents),
                })}
                note={t('opportunities.reports.openCount', '{{n}} open', { n: row.closing_30d_count })}
              />
              <Tile
                id={`opportunity-report-won-${row.currency_code}`}
                label={t('opportunities.reports.newMrrQuarter', 'New MRR this quarter')}
                primary={`${fmt(row.won_quarter_mrr_cents)}${t('opportunities.perMonthSuffix', '/mo')}`}
                secondary={t('opportunities.reports.plusOneTime', '+ {{amount}} one-time', {
                  amount: fmt(row.won_quarter_one_time_cents),
                })}
                note={t('opportunities.reports.wonCount', '{{n}} won · {{quarter}}', {
                  n: row.won_quarter_count,
                  quarter: report.quarter_label,
                })}
              />
            </div>
          </section>
        );
      })}
      {onOpenForecast ? (
        <button
          id="opportunity-report-open-forecast"
          type="button"
          className="text-sm font-medium text-[rgb(var(--color-primary-600))] hover:underline"
          onClick={onOpenForecast}
        >
          {t('opportunities.reports.openForecast', 'Open the seller-calibrated forecast')}
        </button>
      ) : null}
    </div>
  );
}

function Tile({
  id,
  label,
  primary,
  secondary,
  note,
}: {
  id: string;
  label: string;
  primary: string;
  secondary: string;
  note: string;
}) {
  return (
    <div id={id} className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-400))]">{label}</p>
      <p className="mt-1.5 text-xl font-semibold tabular-nums text-[rgb(var(--color-text-900))]">{primary}</p>
      <p className="text-[13px] tabular-nums text-[rgb(var(--color-text-600))]">{secondary}</p>
      <p className="mt-1 text-[11px] text-[rgb(var(--color-text-400))]">{note}</p>
    </div>
  );
}
