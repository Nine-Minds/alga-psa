'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, BriefcaseBusiness, Clock3, PauseCircle } from 'lucide-react';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import { getOpportunityDashboardSnapshot } from '@alga-psa/opportunities/actions';
import { OPPORTUNITY_STAGE_LABELS } from '@alga-psa/opportunities/lib/opportunityStages';
import { oneTimeCents } from '@alga-psa/opportunities/lib/pipelineReporting';
import type { IOpportunityDashboardSnapshot } from '@alga-psa/types';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function OpportunitySnapshotCard() {
  const { t } = useTranslation('msp/opportunities');
  const opportunityFlag = useFeatureFlag('opportunities-module', { defaultValue: false });
  const enabled = typeof opportunityFlag === 'boolean'
    ? opportunityFlag
    : opportunityFlag.enabled;
  const loadingFlag = typeof opportunityFlag === 'boolean'
    ? false
    : opportunityFlag.loading;
  const [snapshot, setSnapshot] = useState<IOpportunityDashboardSnapshot | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    setLoadFailed(false);
    getOpportunityDashboardSnapshot()
      .then((result) => {
        if (active) setSnapshot(result);
      })
      .catch((error) => {
        console.error('Failed to load opportunity dashboard snapshot:', error);
        if (active) setLoadFailed(true);
      });

    return () => {
      active = false;
    };
  }, [enabled]);

  if (loadingFlag || !enabled) return null;

  return (
    <section
      id="opportunity-dashboard-snapshot"
      aria-labelledby="opportunity-dashboard-snapshot-title"
      className="rounded-lg border border-[rgb(var(--color-border-200))] bg-white p-5"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BriefcaseBusiness className="h-5 w-5 text-[rgb(var(--color-primary-500))]" aria-hidden="true" />
            <h2
              id="opportunity-dashboard-snapshot-title"
              className="text-lg font-semibold text-[rgb(var(--color-text-900))]"
            >
              {t('opportunities.snapshot.title', 'Opportunity snapshot')}
            </h2>
          </div>
          <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
            {t(
              'opportunities.snapshot.subtitle',
              'Open pipeline and follow-up work that needs attention.',
            )}
          </p>
        </div>
        <Link
          id="open-opportunities-from-dashboard"
          href="/msp/opportunities"
          className="inline-flex items-center gap-1 text-sm font-medium text-[rgb(var(--color-primary-600))] hover:text-[rgb(var(--color-primary-700))]"
        >
          {t('opportunities.snapshot.open', 'Open opportunities')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      {loadFailed ? (
        <p className="mt-4 rounded-md bg-[rgb(var(--color-warning-50))] px-3 py-2 text-sm text-[rgb(var(--color-text-700))]">
          {t(
            'opportunities.snapshot.unavailable',
            'Opportunity totals are temporarily unavailable. Open Opportunities to continue working.',
          )}
        </p>
      ) : !snapshot ? (
        <div
          className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3"
          aria-label={t('opportunities.snapshot.loading', 'Loading opportunity snapshot')}
        >
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-16 animate-pulse rounded-md bg-[rgb(var(--color-border-100))]" />
          ))}
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Metric label={t('opportunities.snapshot.openCount', 'Open opportunities')} value={snapshot.open_count} icon={BriefcaseBusiness} />
            <Metric label={t('opportunities.snapshot.actionsDue', 'Actions due')} value={snapshot.queue_counts.actions_due} icon={Clock3} />
            <Metric label={t('opportunities.snapshot.stalled', 'Stalled')} value={snapshot.queue_counts.stalled} icon={PauseCircle} />
          </div>

          <div className="mt-5 border-t border-[rgb(var(--color-border-100))] pt-4">
            <h3 className="text-sm font-semibold text-[rgb(var(--color-text-800))]">
              {t('opportunities.snapshot.pipelineByStage', 'Pipeline by stage')}
            </h3>
            {snapshot.pipeline_by_stage.length === 0 ? (
              <p className="mt-2 text-sm text-[rgb(var(--color-text-500))]">
                {t('opportunities.snapshot.empty', 'No open opportunities yet.')}
              </p>
            ) : (
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                {snapshot.pipeline_by_stage.map((row) => (
                  <div
                    key={`${row.stage}:${row.currency_code}`}
                    className="flex items-center justify-between rounded-md bg-[rgb(var(--color-border-50))] px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-[rgb(var(--color-text-800))]">
                        {t(
                          OPPORTUNITY_STAGE_LABELS[row.stage].key,
                          OPPORTUNITY_STAGE_LABELS[row.stage].fallback,
                        )}
                      </p>
                      <p className="text-xs text-[rgb(var(--color-text-500))]">
                        {t(
                          'opportunities.snapshot.opportunityCount',
                          row.opportunity_count === 1
                            ? '{{count}} opportunity'
                            : '{{count}} opportunities',
                          { count: row.opportunity_count },
                        )}
                      </p>
                    </div>
                    <div className="text-right text-xs text-[rgb(var(--color-text-600))]">
                      <p>
                        {t('opportunities.snapshot.mrr', '{{amount}} MRR', {
                          amount: formatCurrencyFromMinorUnits(row.mrr_cents, undefined, row.currency_code),
                        })}
                      </p>
                      <p>
                        {t('opportunities.snapshot.oneTime', '{{amount}} one-time', {
                          amount: formatCurrencyFromMinorUnits(oneTimeCents(row), undefined, row.currency_code),
                        })}
                      </p>
                      {row.hardware_cents > 0 ? (
                        <p className="text-[rgb(var(--color-text-400))]">
                          {t('opportunities.snapshot.hardwareIncluded', 'incl. {{amount}} hardware', {
                            amount: formatCurrencyFromMinorUnits(row.hardware_cents, undefined, row.currency_code),
                          })}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof BriefcaseBusiness;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-[rgb(var(--color-primary-50))] px-3 py-3">
      <Icon className="h-5 w-5 text-[rgb(var(--color-primary-500))]" aria-hidden="true" />
      <div>
        <p className="text-xl font-semibold leading-none text-[rgb(var(--color-text-900))]">{value}</p>
        <p className="mt-1 text-xs text-[rgb(var(--color-text-600))]">{label}</p>
      </div>
    </div>
  );
}
