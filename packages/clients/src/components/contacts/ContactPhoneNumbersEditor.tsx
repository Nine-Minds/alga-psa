'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type {
  ContactPhoneCanonicalType,
  ContactPhoneNumberInput,
  IContactPhoneNumber,
} from '@alga-psa/types';
import { CONTACT_PHONE_CANONICAL_TYPES } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { PhoneInput } from '@alga-psa/ui/components/PhoneInput';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { cn } from '@alga-psa/ui/lib/utils';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { validatePhoneNumber } from '@alga-psa/validation';
import type { ICountry } from '@alga-psa/clients/actions';

type EditablePhoneRow = ContactPhoneNumberInput & {
  _localId?: string;
};

const CANONICAL_PHONE_TYPE_OPTIONS = CONTACT_PHONE_CANONICAL_TYPES.map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}));

const PHONE_TYPE_OPTIONS = [
  ...CANONICAL_PHONE_TYPE_OPTIONS,
  { value: 'custom', label: 'Custom' },
];

const COUNTRY_CODE_ONLY_PATTERN = /^\+\d{1,4}\s*$/;

function normalizeCustomTypeLabel(label: string | null | undefined): string {
  return (label ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function compactContactPhoneNumbers(
  rows: Array<ContactPhoneNumberInput | IContactPhoneNumber>
): ContactPhoneNumberInput[] {
  const compacted = getMeaningfulPhoneRows(rows);

  if (compacted.length === 0) {
    return [];
  }

  const defaultIndex = compacted.findIndex((row) => row.is_default);
  const normalizedDefaultIndex = defaultIndex >= 0 ? defaultIndex : 0;

  return compacted.map((row, index) => ({
    ...row,
    is_default: index === normalizedDefaultIndex,
    display_order: index,
  }));
}

function getMeaningfulPhoneRows(
  rows: Array<ContactPhoneNumberInput | IContactPhoneNumber>
): ContactPhoneNumberInput[] {
  const compacted: ContactPhoneNumberInput[] = [];

  rows.forEach((row, index) => {
    const phone_number = row.phone_number?.trim() ?? '';
    const custom_type = row.custom_type?.trim() ?? '';
    const canonical_type = row.canonical_type ?? null;

    if (!phone_number && !custom_type && !canonical_type) {
      return;
    }

    compacted.push({
      contact_phone_number_id: row.contact_phone_number_id,
      phone_number,
      canonical_type: canonical_type === null ? null : (custom_type ? null : canonical_type || 'work'),
      custom_type: custom_type || (canonical_type === null ? '' : null),
      is_default: Boolean(row.is_default),
      display_order: index,
    });
  });

  return compacted;
}

export function validateContactPhoneNumbers(
  rows: Array<ContactPhoneNumberInput | IContactPhoneNumber>
): string[] {
  const errors: string[] = [];
  const compacted = getMeaningfulPhoneRows(rows);

  const defaultCount = compacted.filter((row) => row.is_default).length;
  if (compacted.length > 0 && defaultCount !== 1) {
    errors.push('Select exactly one default phone number.');
  }

  const seenCustomTypes = new Set<string>();

  compacted.forEach((row, index) => {
    const rowLabel = `Phone ${index + 1}`;

    if (!row.phone_number || COUNTRY_CODE_ONLY_PATTERN.test(row.phone_number)) {
      errors.push(`${rowLabel}: Enter a complete phone number.`);
      return;
    }

    const phoneError = validatePhoneNumber(row.phone_number);
    if (phoneError) {
      errors.push(`${rowLabel}: ${phoneError}`);
    }

    const customType = row.custom_type?.trim() ?? '';
    const canonicalType = row.canonical_type ?? null;
    if (customType) {
      const normalizedCustomType = normalizeCustomTypeLabel(customType);
      if (seenCustomTypes.has(normalizedCustomType)) {
        errors.push(`${rowLabel}: Custom phone type labels must be unique.`);
      } else {
        seenCustomTypes.add(normalizedCustomType);
      }
    } else if (!canonicalType) {
      errors.push(`${rowLabel}: Choose a phone type.`);
    }
  });

  return Array.from(new Set(errors));
}

function toEditablePhoneRows(
  rows: Array<ContactPhoneNumberInput | IContactPhoneNumber>
): EditablePhoneRow[] {
  return rows.map((row, index) => ({
    contact_phone_number_id: row.contact_phone_number_id,
    phone_number: row.phone_number ?? '',
    canonical_type: row.canonical_type === null ? null : row.custom_type ? null : row.canonical_type ?? 'work',
    custom_type: row.canonical_type === null ? (row.custom_type ?? '') : row.custom_type ?? null,
    is_default: Boolean(row.is_default),
    display_order: row.display_order ?? index,
    _localId: row.contact_phone_number_id ?? `phone-row-${index}`,
  }));
}

function createEmptyPhoneRow(isDefault: boolean): EditablePhoneRow {
  return {
    phone_number: '',
    canonical_type: 'work',
    custom_type: null,
    is_default: isDefault,
    display_order: 0,
    _localId: `phone-row-${Math.random().toString(36).slice(2, 9)}`,
  };
}

function inferCountryCode(phoneNumber: string, countries: ICountry[]): string {
  const trimmedPhoneNumber = phoneNumber.trim();
  if (!trimmedPhoneNumber.startsWith('+')) {
    return 'US';
  }

  const matches = countries
    .filter((country) => country.phone_code && trimmedPhoneNumber.startsWith(country.phone_code))
    .sort((a, b) => (b.phone_code?.length ?? 0) - (a.phone_code?.length ?? 0));

  return matches[0]?.code ?? 'US';
}

interface ContactPhoneRowProps {
  id: string;
  index: number;
  row: EditablePhoneRow;
  countries: ICountry[];
  customTypeSuggestions: string[];
  disabled?: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canRemove: boolean;
  onChange: (updates: Partial<EditablePhoneRow>) => void;
  onSetDefault: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

const ContactPhoneRow: React.FC<ContactPhoneRowProps> = ({
  id,
  index,
  row,
  countries,
  customTypeSuggestions,
  disabled = false,
  canMoveUp,
  canMoveDown,
  canRemove,
  onChange,
  onSetDefault,
  onMoveUp,
  onMoveDown,
  onRemove,
}) => {
  const rowKey = row.contact_phone_number_id ?? row._localId ?? `${index}`;
  const [countryCode, setCountryCode] = useState(() => inferCountryCode(row.phone_number ?? '', countries));
  const phoneCode = countries.find((country) => country.code === countryCode)?.phone_code;
  const typeValue = row.canonical_type === null ? 'custom' : row.canonical_type ?? 'work';

  useEffect(() => {
    setCountryCode((current) => {
      if (!row.phone_number?.trim()) {
        return current;
      }
      const inferred = inferCountryCode(row.phone_number, countries);
      return current === inferred ? current : inferred;
    });
  }, [countries, row.phone_number, rowKey]);

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4" data-testid={`${id}-row-${index}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-gray-900">Phone {index + 1}</div>
          <div className="text-xs text-gray-500">
            {row.is_default ? 'Default phone number' : 'Secondary phone number'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name={`${id}-default-phone`}
              checked={row.is_default}
              onChange={onSetDefault}
              disabled={disabled}
              data-testid={`${id}-default-${index}`}
            />
            Default
          </label>
          <Button
            id={`${id}-move-up-${index}`}
            type="button"
            variant="ghost"
            size="sm"
            onClick={onMoveUp}
            disabled={disabled || !canMoveUp}
            aria-label={`Move phone ${index + 1} up`}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            id={`${id}-move-down-${index}`}
            type="button"
            variant="ghost"
            size="sm"
            onClick={onMoveDown}
            disabled={disabled || !canMoveDown}
            aria-label={`Move phone ${index + 1} down`}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button
            id={`${id}-remove-${index}`}
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={disabled || !canRemove}
            aria-label={`Remove phone ${index + 1}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <PhoneInput
          id={`${id}-phone-${index}`}
          label="Phone Number"
          value={row.phone_number ?? ''}
          onChange={(value) => onChange({ phone_number: value })}
          countryCode={countryCode}
          phoneCode={phoneCode}
          countries={countries}
          onCountryChange={setCountryCode}
          allowExtensions={true}
          disabled={disabled}
          data-automation-id={`${id}-phone-${index}`}
        />
        <div className="space-y-2">
          <Label htmlFor={`${id}-type-${index}`}>Phone Type</Label>
          <CustomSelect
            id={`${id}-type-${index}`}
            value={typeValue}
            onValueChange={(value) => {
              if (value === 'custom') {
                onChange({ canonical_type: null, custom_type: row.custom_type ?? '' });
                return;
              }

              onChange({
                canonical_type: value as ContactPhoneCanonicalType,
                custom_type: null,
              });
            }}
            options={PHONE_TYPE_OPTIONS}
            disabled={disabled}
          />
          {typeValue === 'custom' && (
            <div className="space-y-2">
              <Input
                id={`${id}-custom-type-${index}`}
                value={row.custom_type ?? ''}
                onChange={(event) => onChange({
                  canonical_type: null,
                  custom_type: event.target.value,
                })}
                list={`${id}-custom-type-suggestions`}
                placeholder="Enter a custom phone type"
                disabled={disabled}
                data-automation-id={`${id}-custom-type-${index}`}
              />
              <datalist id={`${id}-custom-type-suggestions`}>
                {customTypeSuggestions.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface ContactPhoneNumbersEditorProps {
  id: string;
  value: Array<ContactPhoneNumberInput | IContactPhoneNumber>;
  onChange: (rows: ContactPhoneNumberInput[]) => void;
  countries: ICountry[];
  customTypeSuggestions?: string[];
  disabled?: boolean;
  errorMessages?: string[];
  onValidationChange?: (errors: string[]) => void;
  allowEmpty?: boolean;
}

const ContactPhoneNumbersEditor: React.FC<ContactPhoneNumbersEditorProps> = ({
  id,
  value,
  onChange,
  countries,
  customTypeSuggestions = [],
  disabled = false,
  errorMessages,
  onValidationChange,
  allowEmpty = true,
}) => {
  const rows = useMemo(() => {
    const existingRows = toEditablePhoneRows(value);
    if (existingRows.length > 0 || allowEmpty) {
      return existingRows;
    }
    return [createEmptyPhoneRow(true)];
  }, [allowEmpty, value]);

  const validationErrors = useMemo(() => validateContactPhoneNumbers(rows), [rows]);

  useEffect(() => {
    if (onValidationChange) {
      onValidationChange(validationErrors);
    }
  }, [onValidationChange, validationErrors]);

  const displayedErrors = errorMessages ?? validationErrors;

  const updateRows = (nextRows: EditablePhoneRow[]) => {
    onChange(compactContactPhoneNumbers(nextRows));
  };

  const handleRowChange = (index: number, updates: Partial<EditablePhoneRow>) => {
    updateRows(
      rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...updates } : row)
    );
  };

  const handleSetDefault = (index: number) => {
    updateRows(
      rows.map((row, rowIndex) => ({
        ...row,
        is_default: rowIndex === index,
      }))
    );
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= rows.length) {
      return;
    }

    const nextRows = [...rows];
    const [row] = nextRows.splice(index, 1);
    nextRows.splice(targetIndex, 0, row);
    updateRows(nextRows);
  };

  const handleRemove = (index: number) => {
    const nextRows = rows.filter((_, rowIndex) => rowIndex !== index);
    if (nextRows.length === 0) {
      updateRows([]);
      return;
    }

    const hasDefault = nextRows.some((row) => row.is_default);
    updateRows(
      nextRows.map((row, rowIndex) => ({
        ...row,
        is_default: hasDefault ? row.is_default : rowIndex === 0,
      }))
    );
  };

  const handleAddPhone = () => {
    updateRows([
      ...rows,
      createEmptyPhoneRow(rows.length === 0),
    ]);
  };

  return (
    <div className="space-y-4" data-testid={id}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label className="text-sm font-medium text-gray-900">Phone Numbers</Label>
          <p className="text-xs text-gray-500">
            Add one or more phone numbers and choose exactly one default.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleAddPhone}
          disabled={disabled}
          id={`${id}-add-phone`}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add phone
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
          No phone numbers yet.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <ContactPhoneRow
              key={row.contact_phone_number_id ?? row._localId ?? `${index}`}
              id={id}
              index={index}
              row={row}
              countries={countries}
              customTypeSuggestions={customTypeSuggestions}
              disabled={disabled}
              canMoveUp={index > 0}
              canMoveDown={index < rows.length - 1}
              canRemove={rows.length > 0}
              onChange={(updates) => handleRowChange(index, updates)}
              onSetDefault={() => handleSetDefault(index)}
              onMoveUp={() => handleMove(index, -1)}
              onMoveDown={() => handleMove(index, 1)}
              onRemove={() => handleRemove(index)}
            />
          ))}
        </div>
      )}

      {displayedErrors.length > 0 && (
        <div className={cn('rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700')}>
          <ul className="list-disc space-y-1 pl-5">
            {displayedErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ContactPhoneNumbersEditor;
