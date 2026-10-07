'use client';

import React from 'react';
import { Lightbulb, Plus } from 'lucide-react';

import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

import type { WorkflowEntityLookupSuggestion, WorkflowEventDetailTip } from './workflowEntityLookupSuggestions';

/**
 * Explains that the workflow input carries only an entity id and offers to add the step that loads
 * the entity's details (e.g. Find Ticket for `payload.ticketId`).
 */
export const WorkflowEntityLookupHint: React.FC<{
  idPrefix: string;
  suggestions: WorkflowEntityLookupSuggestion[];
  getActionLabel: (suggestion: WorkflowEntityLookupSuggestion) => string;
  onAdd: (suggestion: WorkflowEntityLookupSuggestion) => void;
  /** Where to find details the trigger leaves out (e.g. a customer reply's text). */
  detailTips?: WorkflowEventDetailTip[];
  /** Label of a lookup action, for the detail tips. */
  getLookupLabel?: (tip: WorkflowEventDetailTip) => string;
  disabled?: boolean;
}> = ({ idPrefix, suggestions, getActionLabel, onAdd, detailTips = [], getLookupLabel, disabled = false }) => {
  const { t } = useTranslation('msp/workflows');
  if (suggestions.length === 0 && detailTips.length === 0) return null;

  return (
    <div
      id={`${idPrefix}-entity-lookup-hint`}
      className="space-y-2 rounded border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] px-3 py-2"
      role="note"
    >
      {suggestions.map((suggestion) => {
        const actionLabel = getActionLabel(suggestion);
        const entity = t(`designer.entityLookup.entities.${suggestion.kind}`, { defaultValue: suggestion.kind });
        return (
          <div key={`${suggestion.kind}:${suggestion.payloadField}`} className="flex items-start gap-2 text-xs text-[rgb(var(--color-text-700))]">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[rgb(var(--color-text-500))]" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <p>
                {suggestion.carriedFields.length > 0
                  ? t('designer.entityLookup.messageWithCarried', {
                      defaultValue: 'This trigger already includes {{fields}}. For other {{entity}} details, add “{{action}}”, which looks the {{entity}} up from payload.{{field}}.',
                      fields: suggestion.carriedFields.join(', '),
                      field: suggestion.payloadField,
                      entity,
                      action: actionLabel,
                    })
                  : t('designer.entityLookup.message', {
                      defaultValue: 'This trigger includes only the {{entity}}’s id (payload.{{field}}). To use the {{entity}}’s details, such as its name or status, add “{{action}}” first.',
                      field: suggestion.payloadField,
                      entity,
                      action: actionLabel,
                    })}
              </p>
              <Button
                id={`${idPrefix}-entity-lookup-add-${suggestion.payloadField}`}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onAdd(suggestion)}
                disabled={disabled}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('designer.entityLookup.addButton', { defaultValue: 'Add “{{action}}”', action: actionLabel })}
              </Button>
            </div>
          </div>
        );
      })}
      {detailTips.map((tip) => {
        const action = getLookupLabel?.(tip) ?? tip.lookup.actionId;
        return (
          <div
            key={`tip:${tip.key}`}
            id={`${idPrefix}-event-detail-tip-${tip.key}`}
            className="flex items-start gap-2 text-xs text-[rgb(var(--color-text-700))]"
          >
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[rgb(var(--color-text-500))]" aria-hidden="true" />
            <p className="min-w-0 flex-1">
              {tip.availableAt
                ? t(`designer.entityLookup.tips.${tip.key}.available`, {
                    defaultValue: tip.messages.available,
                    path: tip.availableAt,
                    action,
                  })
                : t(`designer.entityLookup.tips.${tip.key}.afterLookup`, {
                    defaultValue: tip.messages.afterLookup,
                    detail: tip.detailPath,
                    action,
                  })}
            </p>
          </div>
        );
      })}
    </div>
  );
};

export default WorkflowEntityLookupHint;
