'use client';

import React from 'react';

import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export const WorkflowStepNameField: React.FC<{
  stepId: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}> = ({ stepId, value, onChange, disabled = false }) => {
  const { t } = useTranslation('msp/workflows');
  return (
    <Input
      id={`workflow-step-name-${stepId}`}
      label={t('stepNameField.label', { defaultValue: 'Step name' })}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
};
