'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { PrintButton } from '@alga-psa/ui/components/PrintButton';
import { PrintableDetailHeader } from '@alga-psa/ui/components/PrintableDetailHeader';
import { PrintableSummary } from '@alga-psa/ui/components/PrintableSummary';
import { PrintableTable, type PrintableTableColumn } from '@alga-psa/ui/components/PrintableTable';
import { BentoEyebrow, BentoStat, BentoTile, BentoTileSkeleton } from '@alga-psa/ui/components/bento';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import type { OpportunityStage } from '@alga-psa/types';
import {
  getOpportunityPipelineReport,
  type IOpportunityPipelineReport,
} from '../../actions/reportActions';
import { OPPORTUNITY_STAGE_LABELS } from '../../lib/opportunityStages';

/**
 * The one-screen answer to "how much is in the pipeline and what closes soon".
 * Grouped per currency; one-time always means NRR + hardware. Every total
 * opens up: the stage rows behind it are listed, and each row walks through to
 * the deals it counted, so no figure here is a number you have to take on
 * faith.
 */
export function OpportunityReportsView({
  onOpenForecast,
  onOpenStage,
}: {
  onOpenForecast?: () => void;
  /** Walks through to the Pipeline tab, filtered to the stage that was clicked. */
  onOpenStage?: (stage: OpportunityStage) => void;
}) {
  const { t } = useTranslation('msp/opportunities');
  const [report, setReport] = useState<IOpportunityPipelineReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getOpportunityPipelineReport()
      .then((result) => {
        if (active) {
          setReport(result);
          setExpanded(result.by_currency[0]?.currency_code ?? null);
        }
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
          <BentoTileSkeleton key={item} id={`opportunity-report-skeleton-${item}`} />
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
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <p className="max-w-2xl text-[13px] text-[rgb(var(--color-text-500))]">
          {t(
            'opportunities.reports.intro',
            'Open pipeline as it stands today, grouped by the currency each deal is priced in. Open a total to see the stages behind it, then select a stage to review the deals it counted.'
          )}
        </p>
        <PrintButton
          id="opportunity-report-print"
          type="button"
          size="xs"
          variant="outline"
          label={t('opportunities.reports.print', 'Print')}
        />
      </div>

      {report.by_currency.map((row) => {
        const fmt = (cents: number) => formatCurrencyFromMinorUnits(cents, undefined, row.currency_code);
        const isExpanded = expanded === row.currency_code;
        return (
          <section key={row.currency_code} className="space-y-3">
            <BentoEyebrow id={`opportunity-report-currency-${row.currency_code}`}>{row.currency_code}</BentoEyebrow>
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
                onOpen={onOpenStage ? () => onOpenStage('won') : undefined}
              />
            </div>

            <Button
              id={`opportunity-report-breakdown-toggle-${row.currency_code}`}
              size="xs"
              variant="ghost"
              className="print:hidden"
              onClick={() => setExpanded(isExpanded ? null : row.currency_code)}
            >
              {isExpanded ? (
                <ChevronDown className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronRight className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              )}
              {t('opportunities.reports.byStage', 'By stage')}
            </Button>

            {isExpanded ? (
              <div
                id={`opportunity-report-breakdown-${row.currency_code}`}
                className="overflow-x-auto rounded-xl border border-[rgb(var(--color-border-200))]"
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[rgb(var(--color-border-100,241_245_249))] text-left text-[11px] uppercase tracking-wide text-[rgb(var(--color-text-400))]">
                      <th className="px-3 py-2 font-semibold">{t('opportunities.list.stage', 'Stage')}</th>
                      <th className="px-3 py-2 text-right font-semibold">{t('opportunities.reports.deals', 'Deals')}</th>
                      <th className="px-3 py-2 text-right font-semibold">{t('opportunities.list.mrr', 'Recurring')}</th>
                      <th className="px-3 py-2 text-right font-semibold">{t('opportunities.list.oneTime', 'One-time')}</th>
                      <th className="px-3 py-2 text-right font-semibold">{t('opportunities.reports.weighted', 'Weighted forecast')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.by_stage.map((stageRow) => {
                      const label = OPPORTUNITY_STAGE_LABELS[stageRow.stage];
                      return (
                        <tr
                          key={stageRow.stage}
                          className="border-b border-[rgb(var(--color-border-100,241_245_249))] last:border-b-0"
                        >
                          <td className="px-3 py-2">
                            {onOpenStage ? (
                              <Button
                                id={`opportunity-report-stage-${row.currency_code}-${stageRow.stage}`}
                                variant="link"
                                size="xs"
                                className="h-auto px-0 py-0 align-baseline text-sm font-medium"
                                onClick={() => onOpenStage(stageRow.stage)}
                              >
                                {t(label.key, label.fallback)}
                              </Button>
                            ) : (
                              t(label.key, label.fallback)
                            )}
                            <span className="ml-2 text-[11px] text-[rgb(var(--color-text-400))]">
                              {t('opportunities.reports.rate', '{{pct}}% base rate', {
                                pct: Math.round(stageRow.rate * 100),
                              })}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{stageRow.opportunity_count}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {fmt(stageRow.mrr_cents)}
                            {t('opportunities.perMonthSuffix', '/mo')}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmt(stageRow.one_time_cents)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-[rgb(var(--color-text-500))]">
                            {fmt(stageRow.weighted_mrr_cents)}
                            {t('opportunities.perMonthSuffix', '/mo')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        );
      })}
      {onOpenForecast ? (
        <Button
          id="opportunity-report-open-forecast"
          variant="link"
          size="sm"
          className="px-0 print:hidden"
          onClick={onOpenForecast}
        >
          {t('opportunities.reports.openForecast', 'Open the calibrated forecast')}
          <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      ) : null}

      <PipelineReportPrintout report={report} />
    </div>
  );
}

/**
 * The print copy of the report: one page region the shared print hook targets,
 * so the printout is the report itself rather than a screenshot of the browser
 * window. Every currency prints its own totals and stage table.
 */
function PipelineReportPrintout({ report }: { report: IOpportunityPipelineReport }) {
  const { t } = useTranslation('msp/opportunities');
  const perMonth = t('opportunities.perMonthSuffix', '/mo');

  return (
    <div className="app-print-root app-print-only" id="opportunities-report-print">
      <PrintableDetailHeader
        title={t('opportunities.reports.printTitle', 'Pipeline report')}
        subtitle={t('opportunities.reports.printSubtitle', 'As of {{date}}', {
          date: new Date().toLocaleDateString(),
        })}
        fields={[
          {
            label: t('opportunities.reports.printCurrencies', 'Currencies'),
            value: report.by_currency.map((row) => row.currency_code).join(', '),
          },
          { label: t('opportunities.reports.printQuarter', 'Quarter'), value: report.quarter_label },
        ]}
      />
      {report.by_currency.map((row) => {
        const fmt = (cents: number) => formatCurrencyFromMinorUnits(cents, undefined, row.currency_code);
        const columns: PrintableTableColumn<(typeof row)['by_stage'][number]>[] = [
          {
            key: 'stage',
            header: t('opportunities.list.stage', 'Stage'),
            render: (stageRow) => {
              const label = OPPORTUNITY_STAGE_LABELS[stageRow.stage];
              return t(label.key, label.fallback);
            },
          },
          {
            key: 'count',
            header: t('opportunities.reports.deals', 'Deals'),
            render: (stageRow) => String(stageRow.opportunity_count),
          },
          {
            key: 'mrr',
            header: t('opportunities.list.mrr', 'Recurring'),
            render: (stageRow) => `${fmt(stageRow.mrr_cents)}${perMonth}`,
          },
          {
            key: 'one_time',
            header: t('opportunities.list.oneTime', 'One-time'),
            render: (stageRow) => fmt(stageRow.one_time_cents),
          },
          {
            key: 'weighted',
            header: t('opportunities.reports.weighted', 'Weighted forecast'),
            render: (stageRow) => `${fmt(stageRow.weighted_mrr_cents)}${perMonth}`,
          },
        ];
        return (
          <section key={row.currency_code}>
            <header className="app-print-table-header">
              <h2>
                {t('opportunities.reports.printCurrencySection', '{{currency}} pipeline', {
                  currency: row.currency_code,
                })}
              </h2>
            </header>
            <PrintableSummary
              metrics={[
                {
                  label: t('opportunities.reports.openPipeline', 'Open pipeline'),
                  value: `${fmt(row.open_mrr_cents)}${perMonth}`,
                },
                {
                  label: t('opportunities.list.oneTime', 'One-time'),
                  value: fmt(row.open_one_time_cents),
                },
                {
                  label: t('opportunities.reports.weighted', 'Weighted forecast'),
                  value: `${fmt(row.weighted_mrr_cents)}${perMonth}`,
                },
                {
                  label: t('opportunities.reports.closing30', 'Closing in 30 days'),
                  value: `${fmt(row.closing_30d_mrr_cents)}${perMonth}`,
                },
                {
                  label: t('opportunities.reports.newMrrQuarter', 'New MRR this quarter'),
                  value: `${fmt(row.won_quarter_mrr_cents)}${perMonth}`,
                },
              ]}
            />
            <PrintableTable
              title={t('opportunities.reports.byStage', 'By stage')}
              rows={row.by_stage}
              columns={columns}
              getRowKey={(stageRow) => `${row.currency_code}-${stageRow.stage}`}
              emptyMessage={t('opportunities.reports.emptyTitle', 'Nothing to report yet')}
            />
          </section>
        );
      })}
    </div>
  );
}

function Tile({
  id,
  label,
  primary,
  secondary,
  note,
  onOpen,
}: {
  id: string;
  label: string;
  primary: string;
  secondary: string;
  note: string;
  onOpen?: () => void;
}) {
  const { t } = useTranslation('msp/opportunities');
  return (
    <BentoTile
      id={id}
      title={label}
      action={
        onOpen ? (
          <Button id={`${id}-open`} size="xs" variant="ghost" className="print:hidden" onClick={onOpen}>
            {t('opportunities.reports.view', 'View')}
          </Button>
        ) : undefined
      }
    >
      <BentoStat id={`${id}-stat`} value={<span className="tabular-nums">{primary}</span>} label={secondary} />
      <p className="mt-1 text-[11px] text-[rgb(var(--color-text-400))]">{note}</p>
    </BentoTile>
  );
}
