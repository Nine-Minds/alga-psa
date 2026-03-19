'use client';

import React from 'react';

import type { ActionInputField } from './mapping';

const buildConstraintHints = (
  constraints: ActionInputField['constraints'] | undefined
): string[] => {
  if (!constraints) return [];

  const hints: string[] = [];

  if (constraints.format) {
    hints.push(`Format: ${constraints.format}`);
  }

  if (constraints.itemType) {
    hints.push(`Each item: ${constraints.itemType}`);
  }

  if (typeof constraints.minLength === 'number' || typeof constraints.maxLength === 'number') {
    hints.push(
      `Length: ${constraints.minLength ?? 0} - ${constraints.maxLength ?? 'any'}`
    );
  }

  if (typeof constraints.minimum === 'number' || typeof constraints.maximum === 'number') {
    hints.push(
      `Range: ${constraints.minimum ?? '-∞'} - ${constraints.maximum ?? '∞'}`
    );
  }

  return hints;
};

export const WorkflowActionInputFieldInfo: React.FC<{
  field: Pick<ActionInputField, 'name' | 'type' | 'description' | 'required' | 'default' | 'examples' | 'constraints'>;
  isMissingRequired?: boolean;
  compact?: boolean;
}> = ({ field, isMissingRequired = false, compact = false }) => {
  const constraintHints = buildConstraintHints(field.constraints);
  const compactHint = field.description ?? constraintHints[0] ?? null;

  return (
    <div className="min-w-0 w-full">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-sm text-gray-700">{field.name}</span>
        {field.required && (
          <span
            className={`text-[11px] font-medium uppercase tracking-wide ${
              isMissingRequired ? 'text-destructive' : 'text-gray-500'
            }`}
            title={isMissingRequired ? 'Required field is missing a value' : 'Required'}
          >
            Required
          </span>
        )}
        <span className="text-xs text-gray-400">{field.type}</span>
      </div>
      {compact && compactHint && (
        <p className="mt-0.5 truncate text-[11px] text-gray-500" title={compactHint}>
          {compactHint}
        </p>
      )}
      {!compact && field.description && (
        <p className="mt-0.5 text-[11px] text-gray-500">{field.description}</p>
      )}
      {!compact && constraintHints.map((hint) => (
        <p key={hint} className="mt-0.5 text-[11px] text-gray-500">
          {hint}
        </p>
      ))}
      {!compact && field.default !== undefined && (
        <p className="mt-0.5 text-[11px] text-gray-500">
          Default: <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-700">{String(field.default)}</code>
        </p>
      )}
      {!compact && field.examples && field.examples.length > 0 && (
        <p className="mt-0.5 text-[11px] text-gray-500">
          Example: <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-700">{String(field.examples[0])}</code>
        </p>
      )}
    </div>
  );
};
