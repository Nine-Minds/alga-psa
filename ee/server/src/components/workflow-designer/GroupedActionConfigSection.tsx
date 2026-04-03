'use client';

import React from 'react';

import { Badge } from '@alga-psa/ui/components/Badge';
import { Card } from '@alga-psa/ui/components/Card';
import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import type { WorkflowDesignerCatalogRecord } from '@alga-psa/workflows/runtime';

const TILE_KIND_LABELS: Record<WorkflowDesignerCatalogRecord['tileKind'], string> = {
  'core-object': 'Core',
  transform: 'Transform',
  app: 'App',
  ai: 'AI',
};

export const buildGroupedActionSelectOptions = (
  record: WorkflowDesignerCatalogRecord
): SelectOption[] =>
  record.actions.map((action) => ({
    value: action.id,
    label: action.label,
  }));

export const GroupedActionConfigSection: React.FC<{
  stepId: string;
  record: WorkflowDesignerCatalogRecord;
  selectedActionId?: string;
  selectedActionDescription?: string;
  onActionChange: (actionId?: string) => void;
  disabled?: boolean;
}> = ({
  stepId,
  record,
  selectedActionId,
  selectedActionDescription,
  onActionChange,
  disabled = false,
}) => {
  const actionOptions = buildGroupedActionSelectOptions(record);
  const helperText = selectedActionDescription?.trim() || record.description?.trim();

  return (
    <div className="space-y-3 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-3">
      <div className="space-y-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--color-text-500))]">Group</div>
        <div className="flex items-center gap-2">
          <div
            id={`workflow-step-group-label-${stepId}`}
            className="text-sm font-semibold text-[rgb(var(--color-text-900))]"
          >
            {record.label}
          </div>
          <Badge variant="secondary">{TILE_KIND_LABELS[record.tileKind]}</Badge>
        </div>
        {helperText && (
          <p
            id={`workflow-step-action-description-${stepId}`}
            className="text-xs text-[rgb(var(--color-text-600))]"
          >
            {helperText}
          </p>
        )}
      </div>

      <CustomSelect
        id={`workflow-step-action-select-${stepId}`}
        label="Action"
        placeholder={`Select a ${record.label} action`}
        options={actionOptions}
        value={selectedActionId ?? ''}
        onValueChange={(value) => onActionChange(value || undefined)}
        disabled={disabled}
        allowClear
      />

      {!selectedActionId && (
        <Card
          id={`workflow-step-action-required-${stepId}`}
          className="border border-destructive/30 bg-destructive/10 p-3"
        >
          <div className="text-xs font-semibold text-destructive">Action required</div>
          <div className="mt-1 text-xs text-destructive">
            Select a {record.label} action before configuring inputs or publishing this workflow.
          </div>
        </Card>
      )}
    </div>
  );
};
