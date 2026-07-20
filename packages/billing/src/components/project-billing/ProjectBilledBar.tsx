'use client';

import { useTranslation } from 'react-i18next';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { formatCents } from './billingViewHelpers';

interface ProjectBilledBarProps {
  invoicedCents: number;
  readyCents: number;
  approvedCents: number;
  /** Contract total for fixed price; billed target (cap or billed) for T&M. */
  totalCents: number | null;
  currency: string | null;
}

function pct(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.max(0, Math.min(100, (part / whole) * 100));
}

/**
 * F135 — ambient "Billed: $X of $Y" segmented bar for the ProjectInfo metadata
 * row. Green = invoiced, blue = approved, amber = ready; shown only when project
 * billing is enabled. Mirrors the Budget-hours bar it sits beside.
 */
export default function ProjectBilledBar({
  invoicedCents,
  readyCents,
  approvedCents,
  totalCents,
  currency,
}: ProjectBilledBarProps) {
  const { t } = useTranslation('features/projects');
  const captured = invoicedCents + approvedCents + readyCents;
  const denominator = totalCents && totalCents > 0 ? totalCents : captured;

  return (
    <div className="flex items-center space-x-2">
      <h5 className="font-bold text-gray-800 dark:text-gray-200">{t('billing.billed.label', 'Billed:')}</h5>
      <div className="flex items-center space-x-3">
        <span className="whitespace-nowrap text-base text-gray-800 dark:text-gray-200">
          {totalCents != null
            ? t('billing.billed.ofTotal', '{{invoiced}} of {{total}}', {
              invoiced: formatCents(invoicedCents, currency),
              total: formatCents(totalCents, currency),
            })
            : formatCents(invoicedCents, currency)}
        </span>
        <Tooltip
          content={
            <div className="p-1">
              <p className="text-sm">{t('billing.billed.invoiced', 'Invoiced: {{amount}}', { amount: formatCents(invoicedCents, currency) })}</p>
              <p className="text-sm">{t('billing.billed.approved', 'Approved: {{amount}}', { amount: formatCents(approvedCents, currency) })}</p>
              <p className="text-sm">{t('billing.billed.ready', 'Ready: {{amount}}', { amount: formatCents(readyCents, currency) })}</p>
              {totalCents != null && (
                <p className="text-sm">{t('billing.billed.total', 'Total: {{amount}}', { amount: formatCents(totalCents, currency) })}</p>
              )}
            </div>
          }
        >
          <div className="flex h-2 w-[170px] overflow-hidden rounded-full bg-[rgb(var(--color-border-100))]">
            <div className="bg-green-500" style={{ width: `${pct(invoicedCents, denominator)}%` }} />
            <div className="bg-blue-500" style={{ width: `${pct(approvedCents, denominator)}%` }} />
            <div className="bg-amber-500" style={{ width: `${pct(readyCents, denominator)}%` }} />
          </div>
        </Tooltip>
      </div>
    </div>
  );
}
