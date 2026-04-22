'use client';

import React, { useState } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Button } from '@alga-psa/ui/components/Button';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';

function toIsoDateString(value: Date | undefined): string {
  if (!value) return '';
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseInitialDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

interface RequestServiceFormField {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  helpText?: string | null;
  options?: Array<{ value?: string; label?: string }>;
}

interface RequestServiceFormLabels {
  selectPlaceholder: string;
  datePlaceholder: string;
  submit: string;
}

interface RequestServiceFormProps {
  action: (formData: FormData) => void | Promise<void>;
  fields: RequestServiceFormField[];
  initialValues: Record<string, unknown>;
  labels: RequestServiceFormLabels;
}

export function RequestServiceForm({
  action,
  fields,
  initialValues,
  labels,
}: RequestServiceFormProps) {
  const [selectValues, setSelectValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of fields) {
      if (field.type === 'select') {
        const value = initialValues[field.key];
        initial[field.key] = typeof value === 'string' ? value : '';
      }
    }
    return initial;
  });

  const [dateValues, setDateValues] = useState<Record<string, Date | undefined>>(() => {
    const initial: Record<string, Date | undefined> = {};
    for (const field of fields) {
      if (field.type === 'date') {
        initial[field.key] = parseInitialDate(initialValues[field.key]);
      }
    }
    return initial;
  });

  const renderHelpText = (helpText?: string | null, extraClass = '') =>
    helpText ? (
      <p className={`text-xs text-[rgb(var(--color-text-600))] ${extraClass}`.trim()}>
        {helpText}
      </p>
    ) : null;

  return (
    <form action={action} encType="multipart/form-data" noValidate className="space-y-4">
      {fields.map((field, index) => {
        const key = field.key || `field_${index}`;
        const label = field.label || key;
        const labelWithRequired = field.required ? `${label} *` : label;
        const helpText = field.helpText ?? null;
        const initialValue = initialValues[key];
        const automationId = `request-service-field-${key}`;

        if (field.type === 'long-text') {
          return (
            <div key={key} className="space-y-1">
              <TextArea
                id={automationId}
                name={key}
                label={labelWithRequired}
                required={field.required}
                defaultValue={typeof initialValue === 'string' ? initialValue : ''}
                rows={4}
              />
              {renderHelpText(helpText)}
            </div>
          );
        }

        if (field.type === 'select' && Array.isArray(field.options)) {
          const options: SelectOption[] = field.options.map((option) => ({
            value: String(option?.value ?? ''),
            label: String(option?.label ?? option?.value ?? ''),
          }));

          return (
            <div key={key} className="space-y-1">
              <label
                htmlFor={automationId}
                className="block text-sm font-medium text-[rgb(var(--color-text-700))]"
              >
                {labelWithRequired}
              </label>
              <CustomSelect
                id={automationId}
                value={selectValues[key] ?? ''}
                onValueChange={(value) =>
                  setSelectValues((previous) => ({ ...previous, [key]: value }))
                }
                options={options}
                placeholder={labels.selectPlaceholder}
                required={field.required}
                allowClear={!field.required}
              />
              <input type="hidden" name={key} value={selectValues[key] ?? ''} />
              {renderHelpText(helpText)}
            </div>
          );
        }

        if (field.type === 'checkbox') {
          return (
            <div key={key} className="space-y-1">
              <Checkbox
                id={automationId}
                name={key}
                label={labelWithRequired}
                defaultChecked={typeof initialValue === 'boolean' ? initialValue : false}
                required={field.required}
              />
              {renderHelpText(helpText, 'ml-6')}
            </div>
          );
        }

        if (field.type === 'file-upload') {
          return (
            <div key={key} className="space-y-1">
              <Input
                id={automationId}
                name={key}
                type="file"
                label={labelWithRequired}
                required={field.required}
              />
              {renderHelpText(helpText)}
            </div>
          );
        }

        if (field.type === 'date') {
          const currentDate = dateValues[key];
          return (
            <div key={key} className="space-y-1">
              <label
                htmlFor={automationId}
                className="block text-sm font-medium text-[rgb(var(--color-text-700))]"
              >
                {labelWithRequired}
              </label>
              <DatePicker
                id={automationId}
                value={currentDate}
                onChange={(date) =>
                  setDateValues((previous) => ({ ...previous, [key]: date }))
                }
                clearable
                required={field.required}
                placeholder={labels.datePlaceholder}
              />
              <input type="hidden" name={key} value={toIsoDateString(currentDate)} />
              {renderHelpText(helpText)}
            </div>
          );
        }

        return (
          <div key={key} className="space-y-1">
            <Input
              id={automationId}
              name={key}
              type="text"
              label={labelWithRequired}
              required={field.required}
              defaultValue={typeof initialValue === 'string' ? initialValue : ''}
            />
            {renderHelpText(helpText)}
          </div>
        );
      })}

      <Button id="request-service-submit" type="submit">
        {labels.submit}
      </Button>
    </form>
  );
}
