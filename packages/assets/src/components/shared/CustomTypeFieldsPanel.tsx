'use client';

import React from 'react';
import type { AssetTypeField } from '@alga-psa/types';
import { Input } from '@alga-psa/ui/components/Input';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';

export interface CustomTypeFieldsPanelProps {
  fields: AssetTypeField[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  errors?: Record<string, string>;
  idPrefix?: string;
  disabled?: boolean;
}

/**
 * F309: schema-driven fields for a custom asset type. One input per
 * fields_schema entry; values read/write attributes[key] on the asset.
 */
export function CustomTypeFieldsPanel({
  fields,
  values,
  onChange,
  errors = {},
  idPrefix = 'custom-type',
  disabled = false,
}: CustomTypeFieldsPanelProps) {
  const renderControl = (field: AssetTypeField) => {
    const fieldId = `${idPrefix}-field-${field.key}`;
    const value = values[field.key];
    const error = errors[field.key];
    const errorClass = error ? 'border-red-500' : '';

    switch (field.kind) {
      case 'number':
        return (
          <Input
            id={fieldId}
            type="number"
            value={typeof value === 'number' ? String(value) : ''}
            onChange={(e) =>
              onChange(field.key, e.target.value === '' ? undefined : Number(e.target.value))
            }
            className={`mt-1 ${errorClass}`}
            disabled={disabled}
          />
        );
      case 'date':
        return (
          <DatePicker
            id={fieldId}
            value={typeof value === 'string' && value ? new Date(value) : undefined}
            onChange={(date) =>
              onChange(field.key, date ? date.toISOString().split('T')[0] : undefined)
            }
            disabled={disabled}
          />
        );
      case 'select':
        return (
          <CustomSelect
            id={fieldId}
            options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
            value={typeof value === 'string' ? value : ''}
            onValueChange={(next) => onChange(field.key, next)}
            className={`mt-1 ${errorClass}`}
            disabled={disabled}
          />
        );
      case 'url':
        return (
          <Input
            id={fieldId}
            type="url"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={`mt-1 ${errorClass}`}
            disabled={disabled}
          />
        );
      case 'text':
      default:
        return (
          <Input
            id={fieldId}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={`mt-1 ${errorClass}`}
            disabled={disabled}
          />
        );
    }
  };

  return (
    <div id={`${idPrefix}-fields`} className="space-y-4">
      {fields.map((field) => {
        const fieldId = `${idPrefix}-field-${field.key}`;
        const error = errors[field.key];

        if (field.kind === 'boolean') {
          return (
            <div key={field.key} id={`${fieldId}-container`} className="flex items-center">
              <Checkbox
                id={fieldId}
                label={field.required ? `${field.label} *` : field.label}
                checked={Boolean(values[field.key])}
                onChange={(e) => onChange(field.key, (e.target as HTMLInputElement).checked)}
                disabled={disabled}
              />
            </div>
          );
        }

        return (
          <div key={field.key} id={`${fieldId}-container`}>
            <label htmlFor={fieldId} className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
              {field.required ? `${field.label} *` : field.label}
            </label>
            {renderControl(field)}
            {error && (
              <p id={`${fieldId}-error`} className="mt-1 text-sm text-red-600">
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default CustomTypeFieldsPanel;
