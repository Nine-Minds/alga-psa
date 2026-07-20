'use client';

import { useTranslation } from 'react-i18next';
import { Card } from '@alga-psa/ui/components/Card';
import type { IProjectBillingCapUsage, IProjectBillingConfig } from '@alga-psa/types';
import type { ProjectBillingRollup } from '../../actions/projectBillingConfigActions';
import { formatCents } from './billingViewHelpers';

interface BudgetVsActualCardProps {
  config: IProjectBillingConfig;
  rollup: ProjectBillingRollup | null;
  capUsage: IProjectBillingCapUsage | null;
}

interface Segment {
  key: string;
  label: string;
  cents: number;
  barClass: string;
  swatchClass: string;
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, (part / whole) * 100));
}

/**
 * F124 — budget vs actual. Fixed-price shows schedule progress (invoiced /
 * approved / ready / remaining) against the contract total. T&M shows billed
 * consumption against the cap, with notify-threshold markers and any write-down.
 */
export default function BudgetVsActualCard({ config, rollup, capUsage }: BudgetVsActualCardProps) {
  const { t } = useTranslation('features/projects');
  const currency = config.currency;
  const isFixed = config.billing_model === 'fixed_price';

  if (isFixed) {
    const total = rollup?.total_price ?? config.total_price ?? 0;
    const invoiced = rollup?.invoiced_amount ?? 0;
    const approved = rollup?.approved_amount ?? 0;
    const ready = rollup?.ready_amount ?? 0;
    const remaining = Math.max(0, (rollup?.remaining_amount ?? total - invoiced - approved - ready));
    const segments: Segment[] = [
      { key: 'invoiced', label: t('billing.budget.invoiced', 'Invoiced'), cents: invoiced, barClass: 'bg-green-500', swatchClass: 'bg-green-500' },
      { key: 'approved', label: t('billing.budget.approved', 'Approved'), cents: approved, barClass: 'bg-blue-500', swatchClass: 'bg-blue-500' },
      { key: 'ready', label: t('billing.budget.ready', 'Ready to bill'), cents: ready, barClass: 'bg-amber-500', swatchClass: 'bg-amber-500' },
      { key: 'remaining', label: t('billing.budget.remaining', 'Remaining'), cents: remaining, barClass: 'bg-[rgb(var(--color-border-200))]', swatchClass: 'bg-[rgb(var(--color-border-300))]' },
    ];

    return (
      <Card id="project-billing-budget-card" className="p-4">
        <h3 className="text-sm font-bold text-[rgb(var(--color-text-900))]">{t('billing.budget.title', 'Budget vs actual')}</h3>
        <p className="mt-0.5 text-xs text-[rgb(var(--color-text-500))]">
          {t('billing.budget.fixedHint', '{{total}} fixed fee · {{mode}} invoices', {
            total: formatCents(total, currency),
            mode: config.invoice_mode === 'standalone'
              ? t('billing.mode.standalone', 'standalone')
              : t('billing.mode.recurring', 'recurring'),
          })}
        </p>

        <div className="my-3 flex h-2.5 overflow-hidden rounded-full bg-[rgb(var(--color-border-100))]">
          {segments.filter((s) => s.key !== 'remaining' && s.cents > 0).map((s) => (
            <div key={s.key} className={s.barClass} style={{ width: `${pct(s.cents, total)}%` }} />
          ))}
        </div>

        <dl className="flex flex-col gap-1.5 text-[13px]">
          {segments.map((s) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-sm ${s.swatchClass}`} />
              <dt className="text-[rgb(var(--color-text-600))]">{s.label}</dt>
              <dd className="ml-auto font-semibold tabular-nums text-[rgb(var(--color-text-900))]">
                {formatCents(s.cents, currency)} · {pct(s.cents, total).toFixed(0)}%
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    );
  }

  // Time & materials
  const billed = capUsage?.billed_amount ?? rollup?.invoiced_amount ?? 0;
  const writtenDown = capUsage?.written_down_amount ?? 0;
  const cap = config.cap_amount;
  const thresholds = config.cap_notify_thresholds ?? [];

  return (
    <Card id="project-billing-budget-card" className="p-4">
      <h3 className="text-sm font-bold text-[rgb(var(--color-text-900))]">{t('billing.budget.title', 'Budget vs actual')}</h3>
      <p className="mt-0.5 text-xs text-[rgb(var(--color-text-500))]">
        {cap == null
          ? t('billing.budget.tmNoCapHint', 'Time & materials · no budget cap')
          : config.cap_behavior === 'hard_cap'
            ? t('billing.budget.tmHardHint', '{{cap}} hard cap — billing stops at the cap', { cap: formatCents(cap, currency) })
            : t('billing.budget.tmNotifyHint', '{{cap}} budget cap — notify only', { cap: formatCents(cap, currency) })}
      </p>

      {cap != null && cap > 0 ? (
        <>
          <div className="relative my-3 h-2.5 rounded-full bg-[rgb(var(--color-border-100))]">
            <div
              className={`h-full rounded-full ${billed >= cap ? 'bg-red-500' : 'bg-purple-500'}`}
              style={{ width: `${pct(billed, cap)}%` }}
            />
            {thresholds.map((threshold) => (
              <span
                key={threshold}
                className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-[rgb(var(--color-text-500))]"
                style={{ left: `${Math.min(100, threshold)}%` }}
                title={t('billing.budget.thresholdMarker', '{{pct}}% notify threshold', { pct: threshold })}
              />
            ))}
          </div>
          <dl className="flex flex-col gap-1.5 text-[13px]">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-sm bg-purple-500" />
              <dt className="text-[rgb(var(--color-text-600))]">{t('billing.budget.billed', 'Billed to date')}</dt>
              <dd className="ml-auto font-semibold tabular-nums text-[rgb(var(--color-text-900))]">
                {formatCents(billed, currency)} · {pct(billed, cap).toFixed(0)}%
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-sm bg-[rgb(var(--color-border-300))]" />
              <dt className="text-[rgb(var(--color-text-600))]">{t('billing.budget.capRemaining', 'Cap remaining')}</dt>
              <dd className="ml-auto font-semibold tabular-nums text-[rgb(var(--color-text-900))]">
                {formatCents(Math.max(0, cap - billed), currency)}
              </dd>
            </div>
          </dl>
        </>
      ) : (
        <dl className="mt-3 text-[13px]">
          <div className="flex items-center justify-between">
            <dt className="text-[rgb(var(--color-text-600))]">{t('billing.budget.billed', 'Billed to date')}</dt>
            <dd className="font-semibold tabular-nums text-[rgb(var(--color-text-900))]">{formatCents(billed, currency)}</dd>
          </div>
        </dl>
      )}

      {writtenDown > 0 && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {t('billing.budget.writtenDown', 'Written down past cap: {{amount}}', { amount: formatCents(writtenDown, currency) })}
        </p>
      )}
    </Card>
  );
}
