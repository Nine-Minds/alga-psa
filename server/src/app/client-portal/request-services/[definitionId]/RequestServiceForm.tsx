'use client';

import React, { useState } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Button } from '@alga-psa/ui/components/Button';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import {
  computeVisibleFieldKeys,
  isMissingRequiredValue,
  type VisibilityContext,
  type VisibilityRule,
} from '../../../../lib/service-requests/formVisibility';
import { CLIENT_SUBMISSION_KEY_FIELD_NAME } from './clientSubmissionKey';

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
  // Date-only strings (what toIsoDateString emits) must round-trip as local dates;
  // `new Date('YYYY-MM-DD')` parses as UTC and can shift the day in negative offsets.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
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
  /** Shown under a visible required field that is still empty when the client submits. */
  requiredField: string;
}

interface RequestServiceFormVisibility {
  enabled: boolean;
  rules: VisibilityRule[];
  context: VisibilityContext;
}

interface RequestServiceFormProps {
  action: (formData: FormData) => void | Promise<void>;
  fields: RequestServiceFormField[];
  initialValues: Record<string, unknown>;
  /** Live conditional-visibility rules; when absent or disabled every field renders. */
  visibility?: RequestServiceFormVisibility;
  labels: RequestServiceFormLabels;
  /**
   * Idempotency key minted once per rendered form attempt. Submitting the same
   * rendered form again (a retry or double-click) resends the same key, so the
   * server resolves duplicates to the original submission.
   */
  clientSubmissionKey: string;
}

export function RequestServiceForm({
  action,
  fields,
  initialValues,
  visibility,
  labels,
  clientSubmissionKey,
}: RequestServiceFormProps) {
  // One value map for every field. Seeded to mirror what the server sees in the
  // submitted payload (text/select/date => string, checkbox => boolean), so the shared
  // evaluator gives the same answer on both sides.
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = { ...initialValues };
    for (const field of fields) {
      const value = initialValues[field.key];
      if (field.type === 'file-upload') {
        continue;
      }
      if (field.type === 'checkbox') {
        initial[field.key] = value === true;
      } else {
        initial[field.key] = typeof value === 'string' ? value : '';
      }
    }
    return initial;
  });
  // Keys of visible required fields that were empty at the last blocked submit.
  const [missingFieldKeys, setMissingFieldKeys] = useState<ReadonlySet<string>>(() => new Set());
  const clearMissing = (key: string) =>
    setMissingFieldKeys((previous) => {
      if (!previous.has(key)) return previous;
      const next = new Set(previous);
      next.delete(key);
      return next;
    });
  const setValue = (key: string, value: unknown) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    clearMissing(key);
  };

  // Hidden fields are not rendered at all: the browser submits no hidden answers and
  // never enforces their `required`.
  const visibleFieldKeys: Set<string> | null =
    visibility?.enabled
      ? new Set(computeVisibleFieldKeys(fields, visibility.rules, values, visibility.context))
      : null;

  // The form is noValidate (the custom select and date picker submit through hidden
  // inputs, which native validation cannot check), so required fields are checked here
  // with the server's own rule. Blocking in the browser keeps the client's answers; the
  // server still re-validates, and a field that is hidden is never required.
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    const missing: string[] = [];
    fields.forEach((field, index) => {
      const key = field.key || `field_${index}`;
      if (!field.required || (visibleFieldKeys && !visibleFieldKeys.has(key))) {
        return;
      }
      if (field.type === 'file-upload') {
        const input = event.currentTarget.elements.namedItem(key);
        const hasFile = input instanceof HTMLInputElement && (input.files?.length ?? 0) > 0;
        if (!hasFile) missing.push(key);
        return;
      }
      if (isMissingRequiredValue(values[key])) {
        missing.push(key);
      }
    });
    setMissingFieldKeys(new Set(missing));
    if (missing.length > 0) {
      event.preventDefault();
      document.getElementById(`request-service-field-${missing[0]}`)?.focus();
    }
  };

  const renderRequiredError = (key: string) =>
    missingFieldKeys.has(key) ? (
      <p id={`request-service-field-${key}-error`} role="alert" className="text-sm text-destructive">
        {labels.requiredField}
      </p>
    ) : null;

  const renderHelpText = (helpText?: string | null, extraClass = '') =>
    helpText ? (
      <p className={`text-xs text-[rgb(var(--color-text-600))] ${extraClass}`.trim()}>
        {helpText}
      </p>
    ) : null;

  return (
    <form
      action={action}
      onSubmit={handleSubmit}
      encType="multipart/form-data"
      noValidate
      className="space-y-4"
    >
      <input
        type="hidden"
        name={CLIENT_SUBMISSION_KEY_FIELD_NAME}
        value={clientSubmissionKey}
      />
      {fields.map((field, index) => {
        const key = field.key || `field_${index}`;
        if (visibleFieldKeys && !visibleFieldKeys.has(key)) {
          return null;
        }
        const label = field.label || key;
        const labelWithRequired = field.required ? `${label} *` : label;
        const helpText = field.helpText ?? null;
        const currentValue = values[key];
        const automationId = `request-service-field-${key}`;

        if (field.type === 'long-text') {
          return (
            <div key={key} className="space-y-1">
              <TextArea
                id={automationId}
                name={key}
                label={labelWithRequired}
                required={field.required}
                value={typeof currentValue === 'string' ? currentValue : ''}
                onChange={(event) => setValue(key, event.target.value)}
                rows={4}
              />
              {renderRequiredError(key)}
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
                value={typeof currentValue === 'string' ? currentValue : ''}
                onValueChange={(value) => setValue(key, value)}
                options={options}
                placeholder={labels.selectPlaceholder}
                required={field.required}
                allowClear={!field.required}
              />
              <input type="hidden" name={key} value={typeof currentValue === 'string' ? currentValue : ''} />
              {renderRequiredError(key)}
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
                checked={currentValue === true}
                onChange={(event) => setValue(key, event.target.checked)}
                required={field.required}
              />
              {renderRequiredError(key)}
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
                onChange={() => clearMissing(key)}
              />
              {renderRequiredError(key)}
              {renderHelpText(helpText)}
            </div>
          );
        }

        if (field.type === 'date') {
          const currentDate = parseInitialDate(currentValue);
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
                onChange={(date) => setValue(key, toIsoDateString(date))}
                clearable
                required={field.required}
                placeholder={labels.datePlaceholder}
              />
              <input type="hidden" name={key} value={toIsoDateString(currentDate)} />
              {renderRequiredError(key)}
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
              value={typeof currentValue === 'string' ? currentValue : ''}
              onChange={(event) => setValue(key, event.target.value)}
            />
            {renderRequiredError(key)}
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
