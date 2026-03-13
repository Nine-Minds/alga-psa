'use client';

import React from 'react';

import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import type { Expr, MappingValue } from '@shared/workflow/runtime/client';

export type WorkflowActionInputSourceModeValue = 'reference' | 'fixed' | 'advanced';
export type WorkflowActionInputAdvancedModeValue = 'expression' | 'secret';
export type WorkflowActionInputFieldLike = {
  type?: string;
  enum?: Array<string | number | boolean | null>;
  default?: unknown;
  picker?: {
    allowsDynamicReference?: boolean;
  };
};

export type WorkflowActionInputPreservedModeValues = {
  preservedFixedValue?: MappingValue;
  preservedReferenceValue?: MappingValue;
};

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

  return /^(payload|vars|meta|error|[A-Za-z_][A-Za-z0-9_]*|\$index)(\.[A-Za-z_$][A-Za-z0-9_$]*|\[\d+\])*$/u.test(trimmed);
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

export function getDefaultWorkflowActionInputSourceMode(
  field: WorkflowActionInputFieldLike
): WorkflowActionInputSourceModeValue {
  if (field.picker && field.picker.allowsDynamicReference === false) {
    return 'fixed';
  }
  if (field.enum?.length) {
    return 'fixed';
  }
  if (field.type === 'boolean' || field.type === 'number' || field.type === 'integer') {
    return 'fixed';
  }
  return 'reference';
}

export function buildDefaultWorkflowActionInputLiteralValue(
  field: WorkflowActionInputFieldLike
): MappingValue {
  if (field.default !== undefined) return field.default as MappingValue;
  if (field.type === 'boolean') return false;
  if (field.type === 'number' || field.type === 'integer') return 0;
  if (field.type === 'array') return [];
  if (field.type === 'object') return {};
  if (field.enum?.length) return field.enum[0] as MappingValue;
  return '';
}

export function createWorkflowActionInputValueForMode(
  field: WorkflowActionInputFieldLike,
  currentValue: MappingValue | undefined,
  mode: WorkflowActionInputSourceModeValue,
  advancedMode: WorkflowActionInputAdvancedModeValue = 'expression'
): MappingValue {
  if (mode === 'reference') {
    if (
      currentValue &&
      typeof currentValue === 'object' &&
      '$expr' in currentValue &&
      isSimpleFieldReferenceExpression((currentValue as Expr).$expr)
    ) {
      return currentValue;
    }
    return { $expr: '' };
  }

  if (mode === 'advanced') {
    if (advancedMode === 'secret') {
      if (currentValue && typeof currentValue === 'object' && '$secret' in currentValue) {
        return currentValue;
      }
      return { $secret: '' };
    }

    if (currentValue && typeof currentValue === 'object' && '$expr' in currentValue) {
      return currentValue;
    }
    return { $expr: '' };
  }

  if (
    currentValue !== undefined &&
    (typeof currentValue !== 'object' ||
      currentValue === null ||
      (!('$expr' in currentValue) && !('$secret' in currentValue)))
  ) {
    return currentValue;
  }

  return buildDefaultWorkflowActionInputLiteralValue(field);
}

export function transitionWorkflowActionInputMode(
  field: WorkflowActionInputFieldLike,
  currentValue: MappingValue | undefined,
  nextMode: WorkflowActionInputSourceModeValue,
  advancedMode: WorkflowActionInputAdvancedModeValue = 'expression',
  preservedValues: WorkflowActionInputPreservedModeValues = {}
): WorkflowActionInputPreservedModeValues & { nextValue: MappingValue } {
  const currentMode = deriveWorkflowActionInputSourceMode(currentValue).mode;
  let preservedFixedValue = preservedValues.preservedFixedValue;
  let preservedReferenceValue = preservedValues.preservedReferenceValue;

  if (currentMode === 'fixed' && currentValue !== undefined) {
    preservedFixedValue = currentValue;
  }

  if (
    currentMode === 'reference' &&
    currentValue &&
    typeof currentValue === 'object' &&
    '$expr' in currentValue &&
    isSimpleFieldReferenceExpression((currentValue as Expr).$expr)
  ) {
    preservedReferenceValue = currentValue;
  }

  const transitionSeedValue =
    nextMode === 'fixed' && preservedFixedValue !== undefined
      ? preservedFixedValue
      : nextMode === 'reference' && preservedReferenceValue !== undefined
        ? preservedReferenceValue
        : currentValue;

  return {
    nextValue: createWorkflowActionInputValueForMode(field, transitionSeedValue, nextMode, advancedMode),
    preservedFixedValue,
    preservedReferenceValue,
  };
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
    <div className="flex flex-col items-end gap-1">
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
      <p className="text-[11px] text-gray-400 text-right">
        Use Advanced only for expressions or secrets.
      </p>
    </div>
  );
};
