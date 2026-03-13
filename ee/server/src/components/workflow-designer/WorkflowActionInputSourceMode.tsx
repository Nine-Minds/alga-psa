'use client';

import React from 'react';

import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import type { Expr, MappingValue } from '@shared/workflow/runtime/client';

export type WorkflowActionInputSourceModeValue = 'reference' | 'fixed' | 'advanced';
export type WorkflowActionInputAdvancedModeValue = 'expression' | 'secret';

const SOURCE_MODE_OPTIONS = [
  { value: 'reference', label: 'Reference' },
  { value: 'fixed', label: 'Fixed value' },
  { value: 'advanced', label: 'Advanced' },
] as const;

const ADVANCED_MODE_OPTIONS = [
  { value: 'expression', label: 'Expression' },
  { value: 'secret', label: 'Secret' },
] as const;

export function isSimpleFieldReferenceExpression(expression: string | undefined): boolean {
  if (!expression) return false;
  const trimmed = expression.trim();
  if (!trimmed) return false;

  return /^(payload|vars|meta|error|item|\$index)(\.[A-Za-z_$][A-Za-z0-9_$]*|\[\d+\])*$/u.test(trimmed);
}

export function deriveWorkflowActionInputSourceMode(
  value: MappingValue | undefined
): {
  mode: WorkflowActionInputSourceModeValue;
  advancedMode: WorkflowActionInputAdvancedModeValue;
} {
  if (value && typeof value === 'object') {
    if ('$secret' in value) {
      return { mode: 'advanced', advancedMode: 'secret' };
    }

    if ('$expr' in value) {
      return isSimpleFieldReferenceExpression((value as Expr).$expr)
        ? { mode: 'reference', advancedMode: 'expression' }
        : { mode: 'advanced', advancedMode: 'expression' };
    }
  }

  return { mode: 'fixed', advancedMode: 'expression' };
}

export const WorkflowActionInputSourceMode: React.FC<{
  idPrefix: string;
  value: MappingValue | undefined;
  onModeChange: (mode: WorkflowActionInputSourceModeValue) => void;
  onAdvancedModeChange: (mode: WorkflowActionInputAdvancedModeValue) => void;
  disabled?: boolean;
}> = ({
  idPrefix,
  value,
  onModeChange,
  onAdvancedModeChange,
  disabled,
}) => {
  const sourceMode = deriveWorkflowActionInputSourceMode(value);

  return (
    <div className="flex items-center gap-2">
      <CustomSelect
        id={`${idPrefix}-source-mode`}
        options={[...SOURCE_MODE_OPTIONS]}
        value={sourceMode.mode}
        onValueChange={(nextMode) => onModeChange(nextMode as WorkflowActionInputSourceModeValue)}
        disabled={disabled}
        className="w-36"
      />
      {sourceMode.mode === 'advanced' && (
        <CustomSelect
          id={`${idPrefix}-advanced-mode`}
          options={[...ADVANCED_MODE_OPTIONS]}
          value={sourceMode.advancedMode}
          onValueChange={(nextMode) => onAdvancedModeChange(nextMode as WorkflowActionInputAdvancedModeValue)}
          disabled={disabled}
          className="w-32"
        />
      )}
    </div>
  );
};
