'use client';

import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { OpportunityStage } from '@alga-psa/types';
import { SUGGESTED_NEXT_ACTIONS } from '../lib/suggestedNextActions';

export function ActionSuggestions({
  id,
  stage,
  onSelect,
}: {
  id: string;
  stage: OpportunityStage;
  onSelect: (value: string) => void;
}) {
  const { t } = useTranslation();
  const suggestions = SUGGESTED_NEXT_ACTIONS[stage];
  if (suggestions.length === 0) return null;

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-[rgb(var(--color-text-500))]">
        {t('opportunities.suggestedActions.label', 'Suggested next actions')}
      </p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion, index) => {
          const value = t(suggestion.key, suggestion.fallback);
          return (
            <Button
              key={suggestion.key}
              id={`${id}-${stage}-${index}`}
              type="button"
              size="xs"
              variant="soft"
              onClick={() => onSelect(value)}
            >
              {value}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
