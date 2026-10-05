'use client';

import type { Expr, MappingValue } from '@alga-psa/workflows/runtime';

export type WorkflowActionInputSourceModeValue = 'reference' | 'fixed' | 'expression';
export type WorkflowActionInputFieldLike = {
  name?: string;
  type?: string;
  required?: boolean;
  enum?: Array<string | number | boolean | null>;
  default?: unknown;
  constraints?: { minimum?: number; maximum?: number };
  children?: WorkflowActionInputFieldLike[];
  /** The author must pick an option themselves; nothing is prefilled (e.g. comment visibility). */
  explicitChoice?: unknown;
  editor?: {
    kind?: string;
    allowsDynamicReference?: boolean;
  };
  picker?: {
    allowsDynamicReference?: boolean;
  };
};

export type WorkflowActionInputPreservedModeValues = {
  preservedFixedValue?: MappingValue;
  preservedReferenceValue?: MappingValue;
  preservedExpressionValue?: MappingValue;
};

export function isSimpleFieldReferenceExpression(expression: string | undefined): boolean {
  if (!expression) return false;
  // A single field sent as a one-item list (`[vars.x.y]`) is still a plain reference.
  const trimmed = expression.trim().replace(/^\[\s*(.*?)\s*\]$/u, '$1');
  if (!trimmed) return false;

  return /^(payload|vars|meta|error|[A-Za-z_][A-Za-z0-9_]*|\$index)(\.[A-Za-z_$][A-Za-z0-9_$]*|\[-?\d+\])*$/u.test(trimmed);
}

export function deriveWorkflowActionInputSourceMode(
  value: MappingValue | undefined
): { mode: WorkflowActionInputSourceModeValue } {
  if (value && typeof value === 'object') {
    if ('$expr' in value) {
      const expression = (value as Expr).$expr;
      return !expression?.trim() || isSimpleFieldReferenceExpression(expression)
        ? { mode: 'reference' }
        : { mode: 'expression' };
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
  // Entity ids have pickers, objects and lists have structured editors, and text has the
  // text-with-fields editor, so they all start with their own editor. A same-name source is applied
  // as a reference by the caller when one exists (see autoMappingSuggestions).
  if (field.editor?.kind === 'picker' || field.editor?.kind === 'custom' || field.picker) {
    return 'fixed';
  }
  if (field.type === 'string' || field.type === 'object' || field.type === 'array') {
    return 'fixed';
  }
  return 'reference';
}

/**
 * The value an input starts with when it gets a fixed value. `chosen` means the author asked for
 * this input (Fill, + Set); otherwise it is being filled in as part of a larger value (a required
 * sub-field of a new object or list row).
 * - The schema default, when there is one.
 * - A yes/no the author chose to set starts at yes: setting it implies wanting it on.
 * - A number starts at 0, moved into the allowed range when 0 is outside it.
 * - A choice starts at its first option, unless the schema asks for an explicit choice: then it
 *   starts empty so nothing is chosen for the author.
 * - Objects get their required sub-fields; lists start empty.
 */
export function buildDefaultWorkflowActionInputLiteralValue(
  field: WorkflowActionInputFieldLike,
  options: { chosen?: boolean } = {}
): MappingValue {
  if (field.default !== undefined && !field.explicitChoice) return field.default as MappingValue;
  if (field.explicitChoice) return '';
  if (field.type === 'boolean') return options.chosen === true;
  if (field.type === 'number' || field.type === 'integer') {
    const { minimum, maximum } = field.constraints ?? {};
    let start = 0;
    if (typeof minimum === 'number' && start < minimum) start = minimum;
    if (typeof maximum === 'number' && start > maximum) start = maximum;
    return field.type === 'integer' ? Math.ceil(start) : start;
  }
  if (field.type === 'array') return [];
  if (field.type === 'object') {
    const next: Record<string, MappingValue> = {};
    for (const child of field.children ?? []) {
      // Optional sub-fields stay unset: the runtime applies their defaults, and "+ Set" adds one.
      if (child.name && child.required && !child.explicitChoice) {
        next[child.name] = buildDefaultWorkflowActionInputLiteralValue(child);
      }
    }
    return next;
  }
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

  if (mode === 'expression') {
    if (
      currentValue &&
      typeof currentValue === 'object' &&
      '$expr' in currentValue
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

  return buildDefaultWorkflowActionInputLiteralValue(field, { chosen: true });
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
  let preservedExpressionValue = preservedValues.preservedExpressionValue;

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

  if (
    currentMode === 'expression' &&
    currentValue &&
    typeof currentValue === 'object' &&
    '$expr' in currentValue
  ) {
    preservedExpressionValue = currentValue;
  }

  const transitionSeedValue =
    nextMode === 'fixed' && preservedFixedValue !== undefined
      ? preservedFixedValue
      : nextMode === 'reference' && preservedReferenceValue !== undefined
        ? preservedReferenceValue
        : nextMode === 'expression' && preservedExpressionValue !== undefined
          ? preservedExpressionValue
          : currentValue;

  return {
    nextValue: createWorkflowActionInputValueForMode(field, transitionSeedValue, nextMode),
    preservedFixedValue,
    preservedReferenceValue,
    preservedExpressionValue,
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
