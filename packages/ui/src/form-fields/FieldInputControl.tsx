'use client';

/**
 * The input control for a field type. One switch, in the registry's own package, so every
 * consumer of the registry renders a type the same way and a new type is added in one place.
 * Knows nothing about service requests, or about forms beyond "an answer is being edited".
 *
 * Controls that do not post themselves (the select, the date pickers, the checkbox list)
 * emit a hidden input when `name` is given, so a plain `<form>` POST carries the answer.
 */
import React from 'react';
import { Input } from '../components/Input';
import { TextArea } from '../components/TextArea';
import { Checkbox } from '../components/Checkbox';
import { RadioGroup } from '../components/RadioGroup';
import SearchableSelect from '../components/SearchableSelect';
import { DatePicker } from '../components/DatePicker';
import { DateTimePicker } from '../components/DateTimePicker';
import { getFieldType } from './registry';
import type { FieldOption, FieldTypeKey } from './types';

export interface FieldInputControlProps {
  /** Element id, also the anchor an error message points at. */
  id: string;
  type: FieldTypeKey | string;
  value: unknown;
  onChange: (value: unknown) => void;
  options?: readonly FieldOption[];
  placeholder?: string | null;
  required?: boolean;
  disabled?: boolean;
  /** Posted field name; omitted when the control is not inside a posting form. */
  name?: string;
  /** Visible label. The control renders it when the layout does not. */
  label?: React.ReactNode;
  invalid?: boolean;
  describedBy?: string;
  /** Multi-select / option lists need wording that the registry must not own. */
  labels?: {
    selectPlaceholder?: string;
    datePlaceholder?: string;
  };
}

function toIsoDateString(value: Date | undefined): string {
  if (!value) return '';
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Date-only strings must round-trip as local dates; `new Date('YYYY-MM-DD')` parses as UTC
 * and can shift the day in a negative offset.
 */
export function parseFieldDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value));

const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const errorRing = 'border-[rgb(var(--color-status-error))]';

export function FieldInputControl(props: FieldInputControlProps): React.ReactElement | null {
  const {
    id,
    type,
    value,
    onChange,
    options,
    placeholder,
    required,
    disabled,
    name,
    label,
    invalid,
    describedBy,
    labels,
  } = props;
  const definition = getFieldType(type);
  const control = definition?.control ?? 'text';
  const selectOptions = (options ?? []).map((option) => ({
    value: option.value,
    label: option.label,
  }));

  switch (control) {
    case 'textarea':
      return (
        <TextArea
          id={id}
          name={name}
          label={typeof label === 'string' ? label : undefined}
          value={asText(value)}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder ?? undefined}
          required={required}
          disabled={disabled}
          rows={4}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          wrapperClassName="mb-0"
        />
      );

    case 'select':
      return (
        <>
          <SearchableSelect
            id={id}
            options={selectOptions}
            value={asText(value)}
            onChange={(next) => onChange(next)}
            placeholder={placeholder || labels?.selectPlaceholder}
            disabled={disabled}
            required={required}
          />
          {name ? <input type="hidden" name={name} value={asText(value)} /> : null}
        </>
      );

    case 'radio':
      // RadioGroup renders real radio inputs, so it posts on its own: no hidden input.
      return (
        <RadioGroup
          id={id}
          name={name ?? id}
          options={selectOptions}
          value={asText(value)}
          onChange={(next) => onChange(next)}
          required={required}
          disabled={disabled}
        />
      );

    case 'multi-select': {
      const selected = asList(value);
      return (
        <div
          id={id}
          role="group"
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="space-y-1.5"
        >
          {selectOptions.map((option) => (
            <Checkbox
              key={option.value}
              id={`${id}-${option.value}`}
              label={option.label}
              checked={selected.includes(option.value)}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, option.value]
                    : selected.filter((entry) => entry !== option.value)
                )
              }
            />
          ))}
          {name
            ? selected.map((entry) => (
                <input key={entry} type="hidden" name={name} value={entry} />
              ))
            : null}
        </div>
      );
    }

    case 'checkbox':
      return (
        <Checkbox
          id={id}
          name={name}
          label={label}
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
          required={required}
          disabled={disabled}
        />
      );

    case 'date': {
      const current = parseFieldDate(value);
      return (
        <>
          <DatePicker
            id={id}
            value={current}
            onChange={(date) => onChange(toIsoDateString(date))}
            clearable
            required={required}
            disabled={disabled}
            placeholder={placeholder || labels?.datePlaceholder}
          />
          {name ? <input type="hidden" name={name} value={toIsoDateString(current)} /> : null}
        </>
      );
    }

    case 'date-time': {
      const current = parseFieldDate(value);
      return (
        <>
          <DateTimePicker
            id={id}
            value={current}
            onChange={(date) => onChange(date ? date.toISOString() : '')}
            clearable
            required={required}
            disabled={disabled}
            placeholder={placeholder || labels?.datePlaceholder}
          />
          {name ? <input type="hidden" name={name} value={asText(value)} /> : null}
        </>
      );
    }

    case 'file':
      return (
        <Input
          id={id}
          name={name}
          type="file"
          label={typeof label === 'string' ? label : undefined}
          required={required}
          disabled={disabled}
          // The file itself rides the native form post; what is reported here is the picked
          // names, so a consumer with no form around it (a preview) can still tell a required
          // upload has been answered. No files picked reads as no answer.
          onChange={(event) => {
            const names = Array.from(event.target.files ?? []).map((file) => file.name);
            onChange(names.length > 0 ? names : undefined);
          }}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          containerClassName="mb-0"
        />
      );

    case 'none':
      return null;

    default: {
      const htmlType =
        control === 'number' ? 'number' : control === 'email' ? 'email' : control === 'url' ? 'url' : control === 'phone' ? 'tel' : 'text';
      return (
        <Input
          id={id}
          name={name}
          type={htmlType}
          inputMode={control === 'number' ? 'decimal' : undefined}
          label={typeof label === 'string' ? label : undefined}
          value={asText(value)}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder ?? undefined}
          required={required}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={invalid ? errorRing : undefined}
          containerClassName="mb-0"
        />
      );
    }
  }
}
