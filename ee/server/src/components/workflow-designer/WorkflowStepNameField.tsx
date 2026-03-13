'use client';

import React from 'react';

import { Input } from '@alga-psa/ui/components/Input';

export const WorkflowStepNameField: React.FC<{
  stepId: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ stepId, value, onChange }) => (
  <Input
    id={`workflow-step-name-${stepId}`}
    label="Step name"
    value={value}
    onChange={(event) => onChange(event.target.value)}
  />
);
