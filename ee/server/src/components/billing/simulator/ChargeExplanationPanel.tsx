'use client';

import React, { useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { cn } from '@alga-psa/ui/lib/utils';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { SimulatedInvoiceLine } from '@alga-psa/types';

interface ChargeExplanationPanelProps {
  line: SimulatedInvoiceLine | null;
  currencyCode: string;
  onClose: () => void;
}

/**
 * Right slide-in panel showing a simulated line's ChargeExplanation: the
 * inputs the arithmetic consumed and the step-by-step math down to the amount.
 * One instance per workspace; clicking another amount repopulates it.
 */
const ChargeExplanationPanel: React.FC<ChargeExplanationPanelProps> = ({
  line,
  currencyCode,
  onClose,
}) => {
  const { t } = useTranslation('msp/contracts');
  const { formatCurrency } = useFormatters();

  // Keep the last line rendered so content doesn't vanish mid slide-out.
  const lastLineRef = useRef<SimulatedInvoiceLine | null>(null);
  if (line) {
    lastLineRef.current = line;
  }
  const open = line !== null;
  const displayLine = line ?? lastLineRef.current;
  const explanation = displayLine?.explanation ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('contractSimulator.explanation.title', { defaultValue: 'Charge breakdown' })}
      aria-hidden={!open}
      className={cn(
        'absolute inset-y-0 right-0 z-20 flex w-[340px] max-w-full transform flex-col border-l border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] shadow-xl transition-transform duration-300',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      <div className="flex items-start gap-2 border-b border-[rgb(var(--color-border-200))] px-4 py-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-[rgb(var(--color-text-900))]">
            {displayLine?.service_name ??
              t('contractSimulator.explanation.title', { defaultValue: 'Charge breakdown' })}
          </h3>
          {displayLine && (
            <div className="mt-0.5 text-xs text-[rgb(var(--color-text-500))]">
              {displayLine.charge_type}
            </div>
          )}
        </div>
        <Button
          id="close-explanation-panel-button"
          variant="icon"
          size="icon"
          className="h-6 w-6 flex-shrink-0"
          onClick={onClose}
          aria-label={t('contractSimulator.explanation.close', { defaultValue: 'Close' })}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        {!explanation ? (
          <div className="py-10 text-center text-xs text-[rgb(var(--color-text-400))]">
            {t('contractSimulator.explanation.noBreakdown', {
              defaultValue: 'No breakdown available',
            })}
          </div>
        ) : (
          <>
            {explanation.inputs.length > 0 && (
              <div className="mb-5">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--color-text-400))]">
                  {t('contractSimulator.explanation.inputs', { defaultValue: 'Inputs' })}
                </div>
                {explanation.inputs.map((input, index) => (
                  <div
                    key={index}
                    className="flex justify-between gap-3 border-b border-dashed border-[rgb(var(--color-border-200))] py-1.5 text-xs last:border-b-0"
                  >
                    <span className="text-[rgb(var(--color-text-500))]">{input.label}</span>
                    <span className="text-right font-mono font-medium text-[rgb(var(--color-text-900))]">
                      {input.value}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {explanation.steps.length > 0 && (
              <div className="mb-5">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--color-text-400))]">
                  {t('contractSimulator.explanation.steps', { defaultValue: 'Arithmetic' })}
                </div>
                {explanation.steps.map((step, index) => {
                  const isLast = index === explanation.steps.length - 1;
                  return (
                    <div
                      key={index}
                      className={cn(
                        'mb-1.5 rounded-md border-l-2 px-2.5 py-1.5 font-mono text-xs leading-relaxed',
                        isLast
                          ? 'border-[rgb(var(--color-primary-500))] bg-[rgb(var(--color-primary-50))] font-medium text-[rgb(var(--color-primary-700))] dark:bg-[rgb(var(--color-primary-400)/0.15)]'
                          : 'border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] text-[rgb(var(--color-text-700))]'
                      )}
                    >
                      {step}
                    </div>
                  );
                })}
              </div>
            )}

            {displayLine && (
              <div className="mb-4 flex items-baseline justify-between rounded-lg border border-[rgb(var(--color-primary-200))] bg-[rgb(var(--color-primary-50))] px-3.5 py-3 dark:bg-[rgb(var(--color-primary-400)/0.15)]">
                <span className="text-xs font-semibold text-[rgb(var(--color-primary-700))]">
                  {t('contractSimulator.explanation.amount', { defaultValue: 'Amount' })}
                </span>
                <span className="font-mono text-lg font-semibold text-[rgb(var(--color-primary-700))]">
                  {formatCurrency(displayLine.net_amount / 100, currencyCode)}
                </span>
              </div>
            )}

            {explanation.note && (
              <p className="text-xs leading-relaxed text-[rgb(var(--color-text-500))]">
                {explanation.note}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ChargeExplanationPanel;
