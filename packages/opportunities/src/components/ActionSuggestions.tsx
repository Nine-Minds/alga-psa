'use client';

import { useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { OpportunityStage } from '@alga-psa/types';
import { SUGGESTED_NEXT_ACTIONS } from '../lib/suggestedNextActions';
import { listOpportunityStepTemplates } from '../actions/opportunityStepActions';

/**
 * What this tenant says the next action should be. The stock list is only a
 * starting point: once someone lays out the firm's own sales process in
 * settings, these buttons are that process, so a new hire is handed the
 * playbook rather than asked to invent one.
 */
export function ActionSuggestions({
  id,
  stage,
  onSelect,
}: {
  id: string;
  stage: OpportunityStage;
  onSelect: (value: string) => void;
}) {
  const { t } = useTranslation('msp/opportunities');
  const [templateTitles, setTemplateTitles] = useState<string[] | null>(null);

  useEffect(() => {
    let active = true;
    // A stage change must not leave the previous stage's steps on screen.
    setTemplateTitles(null);
    listOpportunityStepTemplates(stage)
      .then((templates) => {
        if (active) setTemplateTitles(templates.map((template) => template.title));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [stage]);

  const suggestions = templateTitles?.length
    ? templateTitles
    : SUGGESTED_NEXT_ACTIONS[stage].map((suggestion) => t(suggestion.key, suggestion.fallback));

  if (suggestions.length === 0) return null;

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-[rgb(var(--color-text-500))]">
        {t('opportunities.suggestedActions.label', 'Suggested next actions')}
      </p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((value, index) => (
          <Button
            key={`${value}-${index}`}
            id={`${id}-${stage}-${index}`}
            type="button"
            size="xs"
            variant="soft"
            onClick={() => onSelect(value)}
          >
            {value}
          </Button>
        ))}
      </div>
    </div>
  );
}
