'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IQueueSuggestionItem } from '@alga-psa/types';
import { opportunityValueParts } from '../../lib/format';
import { WhySentenceText } from '../WhySentenceText';

export interface MoneyFoundCardProps {
  item: IQueueSuggestionItem;
  onAccept: (suggestionId: string) => void;
  onDismiss: (suggestionId: string) => void;
  onSnooze: (suggestionId: string) => void;
  /** T&M conversion cards open the evidence one-pager instead of accepting directly. */
  onViewEvidence?: (suggestionId: string) => void;
}

/**
 * Dollar-forward suggestion card: the computed value leads in large type,
 * then what it is, then how to act. Generators write the facts; the card
 * never asks the user to type anything.
 */
export function MoneyFoundCard({ item, onAccept, onDismiss, onSnooze, onViewEvidence }: MoneyFoundCardProps) {
  const { t } = useTranslation();
  const value = opportunityValueParts(item.mrr_cents, item.nrr_cents, 0, item.currency_code);
  const idBase = `opportunity-suggestion-card-${item.suggestion_id}`;
  const showEvidence = item.generator_key === 'tm_conversion' && onViewEvidence;

  return (
    <div
      id={idBase}
      className="flex flex-col rounded-xl border border-[rgb(var(--color-border-200))] bg-white p-4 transition-colors hover:border-[rgb(var(--color-primary-300))] dark:bg-[rgb(var(--color-card-bg,255_255_255))]"
    >
      <div className="text-xl font-semibold tabular-nums text-[rgb(var(--badge-success-text))]">
        {value.amount}
        <span className="text-xs font-medium text-[rgb(var(--color-text-400))]">
          {value.recurring ? t('opportunities.perMonthSuffix', '/mo') : ` ${t('opportunities.oneTime', 'one-time')}`}
        </span>
      </div>
      <div className="mt-0.5 text-[13px] font-semibold text-[rgb(var(--color-text-900))]">{item.title}</div>
      <p className="mt-0.5 mb-3 flex-1 text-xs leading-relaxed text-[rgb(var(--color-text-500))]">{item.how}</p>
      <WhySentenceText why={item.why} className="mb-3 text-xs text-[rgb(var(--color-text-600))]" />
      <div className="flex items-center gap-1.5">
        {showEvidence ? (
          <Button id={`${idBase}-evidence`} size="xs" variant="soft" onClick={() => onViewEvidence(item.suggestion_id)}>
            {t('opportunities.suggestions.seeNumbers', 'See the numbers')}
          </Button>
        ) : (
          <Button id={`${idBase}-accept`} size="xs" variant="soft" onClick={() => onAccept(item.suggestion_id)}>
            {t('opportunities.suggestions.accept', 'Create opportunity')}
          </Button>
        )}
        <Button id={`${idBase}-dismiss`} size="xs" variant="ghost" onClick={() => onDismiss(item.suggestion_id)}>
          {t('opportunities.suggestions.dismiss', 'Dismiss')}
        </Button>
        <Button id={`${idBase}-snooze`} size="xs" variant="ghost" onClick={() => onSnooze(item.suggestion_id)}>
          {t('opportunities.suggestions.snooze', 'Snooze')}
        </Button>
      </div>
    </div>
  );
}
