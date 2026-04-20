'use client';

import React from 'react';

import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useWorkflowInputSourceModeOptions } from '@alga-psa/workflows/hooks/useWorkflowEnumOptions';
import type { Expr, MappingValue } from '@alga-psa/workflows/runtime';

export type WorkflowActionInputSourceModeValue = 'reference' | 'fixed';
export type WorkflowActionInputFieldLike = {
  type?: string;
  enum?: Array<string | number | boolean | null>;
  default?: unknown;
  editor?: {
    allowsDynamicReference?: boolean;
  };
  picker?: {
    allowsDynamicReference?: boolean;
  };
};

export type WorkflowActionInputPreservedModeValues = {
  preservedFixedValue?: MappingValue;
  preservedReferenceValue?: MappingValue;
};

export function isSimpleFieldReferenceExpression(expression: string | undefined): boolean {
  if (!expression) return false;
  const trimmed = expression.trim();
  if (!trimmed) return false;

  return /^(payload|vars|meta|error|[A-Za-z_][A-Za-z0-9_]*|\$index)(\.[A-Za-z_$][A-Za-z0-9_$]*|\[\d+\])*$/u.test(trimmed);
}

export function deriveWorkflowActionInputSourceMode(
  value: MappingValue | undefined
): { mode: WorkflowActionInputSourceModeValue } {
  if (value && typeof value === 'object') {
    if ('$expr' in value) {
      const expression = (value as Expr).$expr;
      return !expression?.trim() || isSimpleFieldReferenceExpression(expression)
        ? { mode: 'reference' }
        : { mode: 'fixed' };
    }
  }

  return { mode: 'fixed' };
}

export function getDefaultWorkflowActionInputSourceMode(
  field: WorkflowActionInputFieldLike
): WorkflowActionInputSourceModeValue {
  if (
    (field.editor && field.editor.allowsDynamicReference === false) ||
    (field.picker && field.picker.allowsDynamicReference === false)
  ) {
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
  mode: WorkflowActionInputSourceModeValue
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
    nextValue: createWorkflowActionInputValueForMode(field, transitionSeedValue, nextMode),
    preservedFixedValue,
    preservedReferenceValue,
  };
}

export function isWorkflowActionInputLegacyValue(value: MappingValue | undefined): boolean {
  if (!value || typeof value !== 'object') return false;
  if ('$secret' in value) return true;
  if ('$expr' in value) {
    const expression = (value as Expr).$expr;
    return Boolean(expression?.trim()) && !isSimpleFieldReferenceExpression(expression);
  }
  return false;
}

export const WorkflowActionInputSourceMode: React.FC<{
  idPrefix: string;
  value: MappingValue | undefined;
  onModeChange: (mode: WorkflowActionInputSourceModeValue) => void;
  disabled?: boolean;
}> = ({
  idPrefix,
  value,
  onModeChange,
  disabled,
}) => {
  const sourceMode = deriveWorkflowActionInputSourceMode(value);
  const sourceModeOptions = useWorkflowInputSourceModeOptions();

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <CustomSelect
          id={`${idPrefix}-source-mode`}
          options={sourceModeOptions}
          value={sourceMode.mode}
          onValueChange={(nextMode) => onModeChange(nextMode as WorkflowActionInputSourceModeValue)}
          disabled={disabled}
          className="w-36"
        />
      </div>
    </div>
  );
};
