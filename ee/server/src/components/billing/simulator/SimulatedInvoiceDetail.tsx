'use client';

import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { cn } from '@alga-psa/ui/lib/utils';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  SimulatedInvoiceLine,
  SimulatedPeriod,
  SimulationDiagnostic,
} from '@alga-psa/types';

interface SimulatedInvoiceDetailProps {
  period: SimulatedPeriod;
  currencyCode: string;
  diagnostics: SimulationDiagnostic[];
  selectedChargeKey: string | null;
  onExplainLine: (line: SimulatedInvoiceLine) => void;
}

const SimulatedInvoiceDetail: React.FC<SimulatedInvoiceDetailProps> = ({
  period,
  currencyCode,
  diagnostics,
  selectedChargeKey,
  onExplainLine,
}) => {
  const { t } = useTranslation('msp/contracts');
  const { formatCurrency, formatDate } = useFormatters();

  const money = (cents: number) => formatCurrency(cents / 100, currencyCode);
  const dateOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

  return (
    <div className="overflow-hidden rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[rgb(var(--color-border-200))] px-4 py-3">
        <div>
          <h4 className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
            {t('contractSimulator.invoiceDetail.title', {
              defaultValue: 'Projected invoice — {{period}}',
              period: period.label,
            })}
          </h4>
          <div className="text-[11px] text-[rgb(var(--color-text-500))]">
            {`${formatDate(period.period_start, dateOptions)} – ${formatDate(period.period_end, dateOptions)} · `}
            {t('contractSimulator.invoiceDetail.draftNote', {
              defaultValue: 'draft, not issued',
            })}
          </div>
        </div>
      </div>

      {diagnostics.length > 0 && (
        <ul className="space-y-1 border-b border-[rgb(var(--color-border-200))] px-4 py-2.5">
          {diagnostics.map((diagnostic, index) => (
            <li
              key={index}
              className="flex items-start gap-1.5 text-xs text-[rgb(var(--color-text-600))]"
            >
              {diagnostic.severity === 'warning' ? (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500 dark:text-amber-400" />
              ) : (
                <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[rgb(var(--color-text-400))]" />
              )}
              {diagnostic.message}
            </li>
          ))}
        </ul>
      )}

      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--color-text-400))]">
              {t('contractSimulator.invoiceDetail.columns.line', { defaultValue: 'Line' })}
            </th>
            <th className="border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--color-text-400))]">
              {t('contractSimulator.invoiceDetail.columns.qty', { defaultValue: 'Qty' })}
            </th>
            <th className="border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--color-text-400))]">
              {t('contractSimulator.invoiceDetail.columns.rate', { defaultValue: 'Rate' })}
            </th>
            <th className="border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--color-text-400))]">
              {t('contractSimulator.invoiceDetail.columns.amount', { defaultValue: 'Amount' })}
            </th>
          </tr>
        </thead>
        <tbody>
          {period.lines.map((line, index) => {
            const selected =
              selectedChargeKey !== null && line.explanation?.chargeKey === selectedChargeKey;
            return (
              <tr key={`${line.line_key}-${line.service_id ?? index}`}>
                <td className="border-b border-[rgb(var(--color-border-200))] px-4 py-2.5 text-xs font-medium text-[rgb(var(--color-text-800))]">
                  {line.service_name}
                  <div className="text-[10px] font-normal text-[rgb(var(--color-text-400))]">
                    {line.charge_type}
                  </div>
                </td>
                <td className="whitespace-nowrap border-b border-[rgb(var(--color-border-200))] px-4 py-2.5 text-right font-mono text-xs text-[rgb(var(--color-text-500))]">
                  {line.quantity_label}
                </td>
                <td className="whitespace-nowrap border-b border-[rgb(var(--color-border-200))] px-4 py-2.5 text-right font-mono text-xs text-[rgb(var(--color-text-500))]">
                  {line.rate_label}
                </td>
                <td className="whitespace-nowrap border-b border-[rgb(var(--color-border-200))] px-2 py-1.5 text-right">
                  <button
                    id={`explain-invoice-line-${period.index}-${index}`}
                    type="button"
                    onClick={() => onExplainLine(line)}
                    title={t('contractSimulator.invoiceDetail.explainHint', {
                      defaultValue: 'Show how this amount was computed',
                    })}
                    className={cn(
                      'w-full rounded px-2 py-1 text-right font-mono text-xs text-[rgb(var(--color-text-900))]',
                      selected
                        ? 'bg-[rgb(var(--color-primary-50))] ring-1 ring-inset ring-[rgb(var(--color-primary-500))] dark:bg-[rgb(var(--color-primary-400)/0.15)]'
                        : 'hover:bg-[rgb(var(--color-primary-50))] hover:ring-1 hover:ring-inset hover:ring-[rgb(var(--color-primary-300))] dark:hover:bg-[rgb(var(--color-primary-400)/0.15)]'
                    )}
                  >
                    {money(line.net_amount)}
                  </button>
                </td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={3} className="px-4 pb-1 pt-3 text-right text-xs text-[rgb(var(--color-text-600))]">
              {t('contractSimulator.invoiceDetail.subtotal', { defaultValue: 'Subtotal' })}
            </td>
            <td className="whitespace-nowrap px-4 pb-1 pt-3 text-right font-mono text-xs font-medium text-[rgb(var(--color-text-900))]">
              {money(period.subtotal)}
            </td>
          </tr>
          <tr>
            <td colSpan={3} className="px-4 py-1 text-right text-xs text-[rgb(var(--color-text-600))]">
              {t('contractSimulator.invoiceDetail.tax', { defaultValue: 'Tax' })}
            </td>
            <td className="whitespace-nowrap px-4 py-1 text-right font-mono text-xs font-medium text-[rgb(var(--color-text-900))]">
              {money(period.tax)}
            </td>
          </tr>
          <tr>
            <td
              colSpan={3}
              className="border-t border-[rgb(var(--color-border-200))] px-4 py-3 text-right text-sm font-semibold text-[rgb(var(--color-text-900))]"
            >
              {t('contractSimulator.invoiceDetail.total', { defaultValue: 'Total' })}
            </td>
            <td className="whitespace-nowrap border-t border-[rgb(var(--color-border-200))] px-4 py-3 text-right font-mono text-base font-semibold text-[rgb(var(--color-text-900))]">
              {money(period.total)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export default SimulatedInvoiceDetail;
