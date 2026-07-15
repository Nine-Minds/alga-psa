'use client';

import { useTranslation } from 'react-i18next';
import { Card } from '@alga-psa/ui/components/Card';
import type { ProjectBillingEconomics } from '@alga-psa/billing/actions/projectBillingConfigActions';
import type { ProjectBillingModel } from '@alga-psa/types';
import { formatCents } from './billingViewHelpers';

interface DeliveryEconomicsCardProps {
  economics: ProjectBillingEconomics;
  currency: string | null;
  billingModel: ProjectBillingModel;
}

/**
 * F125 — hours logged at cost, labor + materials cost, projected margin. Time on
 * fixed-price projects is tracked at cost and never billed, so this card is the
 * profitability read-out that pairs with the schedule's revenue read-out.
 */
export default function DeliveryEconomicsCard({ economics, currency, billingModel }: DeliveryEconomicsCardProps) {
  const { t } = useTranslation('features/projects');
  const totalCost = economics.labor_cost + economics.materials_cost;
  const marginPct = economics.projected_margin_pct;
  const marginPositive = marginPct != null && marginPct >= 0;

  return (
    <Card id="project-billing-economics-card" className="p-4">
      <h3 className="text-sm font-bold text-[rgb(var(--color-text-900))]">
        {t('billing.economics.title', 'Delivery economics')}
      </h3>
      <p className="mt-0.5 text-xs text-[rgb(var(--color-text-500))]">
        {billingModel === 'fixed_price'
          ? t('billing.economics.fixedHint', 'Time on fixed-price projects is tracked at cost — never billed.')
          : t('billing.economics.tmHint', 'Cost basis for the project, shown alongside billed time.')}
      </p>

      <dl className="mt-3">
        <div className="flex items-center justify-between border-b border-dashed border-[rgb(var(--color-border-100))] py-1.5 text-[13px]">
          <dt className="text-[rgb(var(--color-text-500))]">{t('billing.economics.hours', 'Hours logged')}</dt>
          <dd className="font-semibold tabular-nums text-[rgb(var(--color-text-900))]">
            {t('billing.economics.hoursValue', '{{hours}} h', { hours: economics.hours_logged.toFixed(1) })}
          </dd>
        </div>
        <div className="flex items-center justify-between border-b border-dashed border-[rgb(var(--color-border-100))] py-1.5 text-[13px]">
          <dt className="text-[rgb(var(--color-text-500))]">{t('billing.economics.cost', 'Labor + materials cost')}</dt>
          <dd className="font-semibold tabular-nums text-[rgb(var(--color-text-900))]">
            {formatCents(totalCost, economics.cost_currency)}
          </dd>
        </div>
        <div className="flex items-center justify-between py-1.5 text-[13px]">
          <dt className="text-[rgb(var(--color-text-500))]">{t('billing.economics.margin', 'Projected margin')}</dt>
          <dd className="font-semibold tabular-nums">
            {marginPct == null ? (
              <span className="text-[rgb(var(--color-text-400))]">{t('billing.economics.marginUnavailable', '—')}</span>
            ) : (
              <span className={marginPositive ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                {t('billing.economics.marginValue', '{{pct}}%', { pct: marginPct.toFixed(0) })}
              </span>
            )}
          </dd>
        </div>
      </dl>
      {economics.currency_mismatch && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          {t(
            'billing.economics.currencyMismatch',
            'Costs are recorded in {{costCurrency}}, while project revenue is in {{revenueCurrency}}. Projected margin is unavailable without an exchange rate.',
            { costCurrency: economics.cost_currency, revenueCurrency: currency ?? economics.cost_currency },
          )}
        </p>
      )}
      {economics.uncosted_hours > 0 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          {t(
            'billing.economics.uncostedHours',
            '{{hours}} logged hours have no effective employee or default cost rate and contribute $0 to labor cost.',
            { hours: economics.uncosted_hours.toFixed(1) },
          )}
        </p>
      )}
    </Card>
  );
}
