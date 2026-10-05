'use client';

import React from 'react';

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { TFunction } from 'i18next';
import { humanizeWorkflowFieldName } from './workflowFieldNames';
import type { ActionInputField } from './mapping';

const buildConstraintHints = (
  t: TFunction,
  constraints: ActionInputField['constraints'] | undefined
): string[] => {
  if (!constraints) return [];

  const hints: string[] = [];

  if (constraints.format) {
    hints.push(t('actionInputFieldInfo.format', { defaultValue: 'Format: {{value}}', value: constraints.format }));
  }

  if (constraints.itemType) {
    hints.push(t('actionInputFieldInfo.eachItem', { defaultValue: 'Each item: {{value}}', value: constraints.itemType }));
  }

  if (typeof constraints.minLength === 'number' || typeof constraints.maxLength === 'number') {
    hints.push(t('actionInputFieldInfo.length', {
      defaultValue: 'Length: {{min}} - {{max}}',
      min: constraints.minLength ?? 0,
      max: constraints.maxLength ?? t('actionInputFieldInfo.any', { defaultValue: 'any' }),
    }));
  }

  const hasMin = typeof constraints.minimum === 'number';
  const hasMax = typeof constraints.maximum === 'number';
  if (hasMin && hasMax) {
    hints.push(t('actionInputFieldInfo.range', {
      defaultValue: 'Range: {{min}} - {{max}}',
      min: constraints.minimum,
      max: constraints.maximum,
    }));
  } else if (hasMax) {
    hints.push(t('actionInputFieldInfo.atMost', { defaultValue: 'At most {{max}}', max: constraints.maximum }));
  } else if (hasMin) {
    hints.push(t('actionInputFieldInfo.atLeast', { defaultValue: 'At least {{min}}', min: constraints.minimum }));
  }

  return hints;
};

export const WorkflowActionInputFieldInfo: React.FC<{
  field: Pick<ActionInputField, 'name' | 'type' | 'description' | 'required' | 'default' | 'examples' | 'constraints'>;
  isMissingRequired?: boolean;
  compact?: boolean;
}> = ({ field, isMissingRequired = false, compact = false }) => {
  const { t } = useTranslation('msp/workflows');
  const constraintHints = buildConstraintHints(t, field.constraints);
  const compactHint = field.description ?? constraintHints[0] ?? null;

  return (
    <div className="min-w-0 w-full">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {/* A plain-language name first, the input's own name after it for people who know it. */}
        <span className="text-sm text-gray-700">{humanizeWorkflowFieldName(field.name)}</span>
        <code className="text-[11px] text-gray-400">{field.name}</code>
        {field.required && (
          <span
            className={`text-[11px] font-medium uppercase tracking-wide ${
              isMissingRequired ? 'text-destructive' : 'text-gray-500'
            }`}
            title={isMissingRequired
              ? t('actionInputFieldInfo.requiredMissingTitle', { defaultValue: 'Required field is missing a value' })
              : t('actionInputFieldInfo.requiredTitle', { defaultValue: 'Required' })}
          >
            {t('actionInputFieldInfo.required', { defaultValue: 'Required' })}
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
          {t('actionInputFieldInfo.defaultPrefix', { defaultValue: 'Default:' })}{' '}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-700">{String(field.default)}</code>
        </p>
      )}
      {!compact && field.examples && field.examples.length > 0 && (
        <p className="mt-0.5 text-[11px] text-gray-500">
          {t('actionInputFieldInfo.examplePrefix', { defaultValue: 'Example:' })}{' '}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-700">{String(field.examples[0])}</code>
        </p>
      )}
    </div>
  );
};
