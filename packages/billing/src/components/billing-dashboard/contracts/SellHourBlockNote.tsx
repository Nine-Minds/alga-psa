'use client';

import React from 'react';
import { Info } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface SellHourBlockNoteProps {
  id: string;
  className?: string;
}

/**
 * A contract hour bucket only bills the overage, never the included hours.
 * Charging for a block of hours up front is a Prepaid Block contract line,
 * so the hint points at adding one to the contract (issued every billing period for a
 * recurring, billed-in-advance block).
 */
export function SellHourBlockNote({ id, className }: SellHourBlockNoteProps) {
  const { t } = useTranslation('msp/contracts');

  return (
    <p
      id={id}
      className={`flex items-start gap-2 text-xs text-[rgb(var(--color-text-500))] ${className ?? ''}`}
    >
      <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[rgb(var(--color-text-400))]" aria-hidden="true" />
      <span>
        {t('sellHourBlockNote.text', {
          defaultValue:
            "A contract hour bucket bills only the overage. To charge for a block of hours up front, add a Prepaid Block line to the contract and issue it every billing period.",
        })}
      </span>
    </p>
  );
}
