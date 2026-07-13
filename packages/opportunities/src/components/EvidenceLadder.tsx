'use client';

import React from 'react';
import { Check } from 'lucide-react';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IOpportunityEvidenceLadderStep } from '@alga-psa/types';

const STEP_LABEL_KEYS: Record<IOpportunityEvidenceLadderStep['checkpoint'], [string, string]> = {
  identified: ['opportunities.stage.identified', 'Identified'],
  qualified: ['opportunities.stage.qualified', 'Qualified'],
  assessment: ['opportunities.stage.assessment', 'Assessment'],
  proposed: ['opportunities.stage.proposed', 'Proposed'],
  verbal: ['opportunities.stage.verbal', 'Verbal'],
  won: ['opportunities.stage.won', 'Won'],
};

/**
 * The evidence ladder: stages as observed facts, not opinions. Reached steps
 * show their evidence source on hover; skipped checkpoints render dashed
 * (renewals enter mid-ladder). Nothing here is directly draggable or editable —
 * evidence moves deals.
 */
export function EvidenceLadder({
  steps,
  id = 'opportunity-evidence-ladder',
}: {
  steps: IOpportunityEvidenceLadderStep[];
  id?: string;
}) {
  const { t } = useTranslation();

  return (
    <ol id={id} className="flex flex-wrap items-center gap-y-2" aria-label={t('opportunities.ladder', 'Evidence ladder')}>
      {steps.map((step, i) => {
        const [key, fallback] = STEP_LABEL_KEYS[step.checkpoint];
        const label = t(key, fallback);
        const dot = (
          <span
            className={`grid h-6 w-6 place-items-center rounded-full border-2 text-[10px] font-bold ${
              step.state === 'reached'
                ? 'border-[rgb(var(--color-primary-500))] bg-[rgb(var(--color-primary-500))] text-white'
                : step.state === 'skipped'
                  ? 'border-dashed border-[rgb(var(--color-border-400))] text-[rgb(var(--color-text-400))]'
                  : 'border-[rgb(var(--color-border-300))] bg-white text-[rgb(var(--color-text-400))]'
            }`}
            aria-hidden
          >
            {step.state === 'reached' ? <Check className="h-3 w-3" /> : step.state === 'skipped' ? '–' : null}
          </span>
        );
        return (
          <li key={step.checkpoint} className="flex items-center">
            {step.evidence?.detail ? <Tooltip content={step.evidence.detail}>{dot}</Tooltip> : dot}
            <span
              className={`ml-1.5 mr-2 whitespace-nowrap text-[11px] ${
                step.state === 'reached'
                  ? 'font-semibold text-[rgb(var(--color-text-900))]'
                  : 'text-[rgb(var(--color-text-500))]'
              }`}
            >
              {label}
            </span>
            {i < steps.length - 1 ? (
              <span
                className={`mr-2 h-0.5 w-6 flex-none rounded ${
                  step.state === 'reached' ? 'bg-[rgb(var(--color-primary-300))]' : 'bg-[rgb(var(--color-border-200))]'
                }`}
                aria-hidden
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
