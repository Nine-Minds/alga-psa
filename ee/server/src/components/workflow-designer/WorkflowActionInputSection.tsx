'use client';

import React from 'react';

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { MappingPanel, type ActionInputField, type WorkflowDataContext } from './mapping';
import type { InputMapping } from '@alga-psa/workflows/runtime';
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
  disabled?: boolean;
}> = ({
  stepId,
  inputMapping,
  onInputMappingChange,
  targetFields,
  dataContext,
  fieldOptions,
  disabled = false,
}) => {
  const { t } = useTranslation('msp/workflows');
  return (
  <div
    id={`workflow-step-action-inputs-${stepId}`}
    className="mt-4 space-y-3 border-t border-gray-200 pt-4"
  >
    <div className="min-w-0">
      <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
        {t('actionInputSection.heading', { defaultValue: 'Action inputs' })}
      </div>
    </div>

    <MappingPanel
      value={inputMapping}
      onChange={onInputMappingChange}
      targetFields={targetFields}
      dataContext={dataContext}
      fieldOptions={fieldOptions}
      stepId={stepId}
      disabled={disabled}
    />
  </div>
  );
};
