'use client';

import React from 'react';

import { MappingPanel, type ActionInputField, type WorkflowDataContext } from './mapping';
import type { InputMapping } from '@shared/workflow/runtime/client';
import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';

export const WorkflowActionInputSection: React.FC<{
  stepId: string;
  inputMapping: InputMapping;
  onInputMappingChange: (mapping: InputMapping) => void;
  targetFields: ActionInputField[];
  dataContext: WorkflowDataContext;
  fieldOptions: SelectOption[];
  mappedInputFieldCount: number;
  requiredActionInputFields: ActionInputField[];
  unmappedRequiredInputFieldCount: number;
}> = ({
  stepId,
  inputMapping,
  onInputMappingChange,
  targetFields,
  dataContext,
  fieldOptions,
  mappedInputFieldCount,
  requiredActionInputFields,
  unmappedRequiredInputFieldCount,
}) => (
  <div
    id={`workflow-step-action-inputs-${stepId}`}
    className="mt-4 space-y-3 border-t border-gray-200 pt-4"
  >
    <div className="min-w-0">
      <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">Action inputs</div>
      <p className="mt-1 text-xs text-gray-500">
        Configure action fields inline using workflow data, fixed values, or advanced mappings.
      </p>
      <div className="mt-1 text-xs text-gray-500">
        {mappedInputFieldCount} / {targetFields.length} fields configured
      </div>
      {requiredActionInputFields.length > 0 && (
        <div
          id={`workflow-step-input-mapping-required-status-${stepId}`}
          className={`mt-1 text-xs ${
            unmappedRequiredInputFieldCount > 0 ? 'text-destructive' : 'text-emerald-700'
          }`}
        >
          {unmappedRequiredInputFieldCount > 0
            ? `${unmappedRequiredInputFieldCount} required field${unmappedRequiredInputFieldCount === 1 ? '' : 's'} still unmapped`
            : `All ${requiredActionInputFields.length} required fields are mapped`}
        </div>
      )}
    </div>

    <MappingPanel
      value={inputMapping}
      onChange={onInputMappingChange}
      targetFields={targetFields}
      dataContext={dataContext}
      fieldOptions={fieldOptions}
      stepId={stepId}
      sourceTreeMaxHeight="32rem"
    />
  </div>
);
