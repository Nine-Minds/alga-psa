'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ContactPhoneCanonicalType,
  ContactPhoneNumberInput,
  IContactPhoneNumber,
} from '@alga-psa/types';
import { CONTACT_PHONE_CANONICAL_TYPES } from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Label } from '@alga-psa/ui/components/Label';
import { PhoneInput } from '@alga-psa/ui/components/PhoneInput';
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';
import SearchableSelect from '@alga-psa/ui/components/SearchableSelect';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { validatePhoneNumber } from '@alga-psa/validation';
import type { ICountry } from '@alga-psa/clients/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type EditablePhoneRow = ContactPhoneNumberInput & {
  _localId?: string;
};

type ContactPhoneRowInput = ContactPhoneNumberInput | IContactPhoneNumber;

const COUNTRY_CODE_ONLY_PATTERN = /^\+\d{1,4}\s*$/;
const PHONE_ROW_ERROR_PATTERN = /^Phone (\d+):/;
const PHONE_ROW_DETAIL_PATTERN = /^Phone (\d+):\s*(.+)$/;

function normalizeCustomTypeLabel(label: string | null | undefined): string {
  return (label ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function createRowLocalId(index: number): string {
  return `phone-row-${index}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizePhoneRowForDraft(
  row: ContactPhoneRowInput,
  index: number,
  localId?: string
): EditablePhoneRow {
  const isCustomType = row.canonical_type === null;
  const customType = isCustomType ? (row.custom_type ?? '') : null;

  return {
    contact_phone_number_id: row.contact_phone_number_id,
    phone_number: row.phone_number ?? '',
    canonical_type: isCustomType ? null : row.canonical_type ?? 'work',
    custom_type: customType,
    is_default: Boolean(row.is_default),
    display_order: row.display_order ?? index,
    _localId: localId ?? row.contact_phone_number_id ?? createRowLocalId(index),
  };
}

export function normalizeDraftContactPhoneNumbers(
  rows: Array<ContactPhoneRowInput | EditablePhoneRow>
): ContactPhoneNumberInput[] {
  if (rows.length === 0) {
    return [];
  }

  const defaultIndex = rows.findIndex((row) => row.is_default);
  const normalizedDefaultIndex = defaultIndex >= 0 ? defaultIndex : 0;

  return rows.map((row, index) => {
    const phone_number = row.phone_number?.trim() ?? '';
    const isCustomType = row.canonical_type === null;
    const canonical_type = isCustomType ? null : row.canonical_type ?? 'work';
    const custom_type = isCustomType ? (row.custom_type ?? '') : null;

    return {
      contact_phone_number_id: row.contact_phone_number_id,
      phone_number,
      canonical_type,
      custom_type,
      is_default: index === normalizedDefaultIndex,
      display_order: index,
    };
  });
}

export function compactContactPhoneNumbers(
  rows: Array<ContactPhoneRowInput | EditablePhoneRow>
): ContactPhoneNumberInput[] {
  const filteredRows = normalizeDraftContactPhoneNumbers(rows).filter((row) => {
    const phone_number = row.phone_number?.trim() ?? '';
    const custom_type = row.custom_type?.trim() ?? '';
    const canonical_type = row.canonical_type ?? null;

    return Boolean(phone_number || custom_type || canonical_type);
  });

  return normalizeDraftContactPhoneNumbers(filteredRows);
}

export function validateContactPhoneNumbers(
  rows: Array<ContactPhoneNumberInput | IContactPhoneNumber>
): string[] {
  const errors: string[] = [];
  const normalizedRows = normalizeDraftContactPhoneNumbers(rows);

  if (normalizedRows.length === 0) {
    return [];
  }

  const defaultCount = normalizedRows.filter((row) => row.is_default).length;
  if (defaultCount !== 1) {
    errors.push('Select exactly one default phone number.');
  }

  const seenCustomTypes = new Set<string>();

  normalizedRows.forEach((row, index) => {
    const rowLabel = `Phone ${index + 1}`;

    if (!row.phone_number || COUNTRY_CODE_ONLY_PATTERN.test(row.phone_number)) {
      errors.push(`${rowLabel}: Enter a complete phone number.`);
    } else {
      const phoneError = validatePhoneNumber(row.phone_number);
      if (phoneError) {
        errors.push(`${rowLabel}: ${phoneError}`);
      }
    }

    const customType = row.custom_type?.trim() ?? '';
    if (row.canonical_type === null) {
      if (!customType) {
        errors.push(`${rowLabel}: Enter a custom phone type.`);
        return;
      }

      const normalizedCustomType = normalizeCustomTypeLabel(customType);
      if (seenCustomTypes.has(normalizedCustomType)) {
        errors.push(`${rowLabel}: Custom phone type labels must be unique.`);
      } else {
        seenCustomTypes.add(normalizedCustomType);
      }
    }
  });

  return Array.from(new Set(errors));
}

export function translateContactPhoneValidationErrors(
  errors: string[],
  t: (key: string, options?: Record<string, unknown>) => string
): string[] {
  return errors.map((error) => {
    if (error === 'Select exactly one default phone number.') {
      return t('contactPhoneNumbersEditor.validation.selectExactlyOneDefault', {
        defaultValue: 'Select exactly one default phone number.'
      });
    }

    const detailMatch = PHONE_ROW_DETAIL_PATTERN.exec(error);
    if (!detailMatch) {
      return error;
    }

    const rowNumber = Number.parseInt(detailMatch[1] ?? '', 10);
    const detail = detailMatch[2] ?? '';
    const rowPrefix = t('contactPhoneNumbersEditor.validation.phoneRow', {
      defaultValue: 'Phone {{number}}',
      number: rowNumber
    });

    if (detail === 'Enter a complete phone number.') {
      return `${rowPrefix}: ${t('contactPhoneNumbersEditor.validation.enterCompletePhoneNumber', {
        defaultValue: 'Enter a complete phone number.'
      })}`;
    }

    if (detail === 'Enter a custom phone type.') {
      return `${rowPrefix}: ${t('contactPhoneNumbersEditor.validation.enterCustomPhoneType', {
        defaultValue: 'Enter a custom phone type.'
      })}`;
    }

    if (detail === 'Custom phone type labels must be unique.') {
      return `${rowPrefix}: ${t('contactPhoneNumbersEditor.validation.customTypesUnique', {
        defaultValue: 'Custom phone type labels must be unique.'
      })}`;
    }

    return `${rowPrefix}: ${detail}`;
  });
}

function buildEditablePhoneRows(
  rows: Array<ContactPhoneNumberInput | IContactPhoneNumber>,
  previousRows: EditablePhoneRow[] = []
): EditablePhoneRow[] {
  return rows.map((row, index) => {
    const previousRow = previousRows.find((candidate) => {
      if (row.contact_phone_number_id && candidate.contact_phone_number_id) {
        return candidate.contact_phone_number_id === row.contact_phone_number_id;
      }

      return candidate.display_order === (row.display_order ?? index);
    });

    return normalizePhoneRowForDraft(row, index, previousRow?._localId);
  });
}

function createEmptyPhoneRow(isDefault: boolean): EditablePhoneRow {
  return {
    phone_number: '',
    canonical_type: 'work',
    custom_type: null,
    is_default: isDefault,
    display_order: 0,
    _localId: createRowLocalId(0),
  };
}

function buildPhoneRowsSignature(rows: ContactPhoneNumberInput[]): string {
  return JSON.stringify(rows);
}

export function moveContactPhoneRows(
  rows: EditablePhoneRow[],
  index: number,
  direction: -1 | 1
): EditablePhoneRow[] {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= rows.length) {
    return rows;
  }

  const nextRows = [...rows];
  const [row] = nextRows.splice(index, 1);
  nextRows.splice(targetIndex, 0, row);
  return nextRows.map((entry, rowIndex) => ({
    ...entry,
    display_order: rowIndex,
  }));
}

function inferCountryCode(phoneNumber: string, countries: ICountry[]): string {
  const trimmedPhoneNumber = phoneNumber.trim();
  if (!trimmedPhoneNumber.startsWith('+')) {
    return 'US';
  }

  const matches = countries
    .map((country) => ({
      ...country,
      normalized_phone_code: country.phone_code?.startsWith('+')
        ? country.phone_code
        : country.phone_code
          ? `+${country.phone_code}`
          : undefined,
    }))
    .filter((country) => country.normalized_phone_code && trimmedPhoneNumber.startsWith(country.normalized_phone_code))
    .sort((a, b) => (b.normalized_phone_code?.length ?? 0) - (a.normalized_phone_code?.length ?? 0));

  return matches[0]?.code ?? 'US';
}

function getRowKey(row: EditablePhoneRow, index: number): string {
  return row.contact_phone_number_id ?? row._localId ?? `${index}`;
}

function getVisibleValidationErrors(
  errors: string[],
  rows: EditablePhoneRow[],
  touchedRowKeys: Set<string>
): string[] {
  if (touchedRowKeys.size === 0) {
    return [];
  }

  return errors.filter((error) => {
    const match = PHONE_ROW_ERROR_PATTERN.exec(error);
    if (!match) {
      return false;
    }

    const rowIndex = Number.parseInt(match[1] ?? '', 10) - 1;
    if (rowIndex < 0 || rowIndex >= rows.length) {
      return false;
    }

    return touchedRowKeys.has(getRowKey(rows[rowIndex]!, rowIndex));
  });
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
  onBlur: () => void;
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
  onBlur,
  onSetDefault,
  onMoveUp,
  onMoveDown,
  onRemove,
}) => {
  const { t } = useTranslation('msp/contacts');
  const rowKey = row.contact_phone_number_id ?? row._localId ?? `${index}`;
  const [countryCode, setCountryCode] = useState(() => inferCountryCode(row.phone_number ?? '', countries));
  const phoneCode = countries.find((country) => country.code === countryCode)?.phone_code;
  const typeValue = row.canonical_type === null ? 'custom' : row.canonical_type ?? 'work';
  const phoneTypeOptions = useMemo(
    () => [
      ...CONTACT_PHONE_CANONICAL_TYPES.map((value) => ({
        value,
        label: t(`contactPhoneNumbersEditor.phoneTypes.${value}`, {
          defaultValue: value.charAt(0).toUpperCase() + value.slice(1),
        }),
      })),
      {
        value: 'custom',
        label: t('contactPhoneNumbersEditor.phoneTypes.custom', { defaultValue: 'Custom' }),
      },
    ],
    [t]
  );
  const customTypeOptions = useMemo(
    () => Array.from(
      new Map(
        customTypeSuggestions
          .map((suggestion) => suggestion.trim())
          .filter(Boolean)
          .map((suggestion) => [normalizeCustomTypeLabel(suggestion), suggestion] as const)
      ).values()
    ).map((suggestion) => ({
      value: suggestion,
      label: suggestion,
    })),
    [customTypeSuggestions]
  );

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
    <Card
      className="p-4"
      data-testid={`${id}-row-${index}`}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div>
          <div className="text-sm font-medium text-[rgb(var(--color-text-900))]">
            {t('contactPhoneNumbersEditor.row.title', {
              defaultValue: 'Phone {{number}}',
              number: index + 1,
            })}
          </div>
          <div className="text-xs text-muted-foreground">
            {row.is_default
              ? t('contactPhoneNumbersEditor.row.defaultDescription', {
                defaultValue: 'Default phone number',
              })
              : t('contactPhoneNumbersEditor.row.secondaryDescription', {
                defaultValue: 'Secondary phone number',
              })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <RadioGroup
            id={`${id}-default-${index}`}
            name={`${id}-default-phone`}
            value={row.is_default ? `phone-${index}` : undefined}
            onChange={() => onSetDefault()}
            options={[
              {
                value: `phone-${index}`,
                label: t('contactPhoneNumbersEditor.row.defaultLabel', { defaultValue: 'Default' }),
              },
            ]}
            orientation="horizontal"
            className="gap-2"
            disabled={disabled}
          />
          <Button
            id={`${id}-move-up-${index}`}
            type="button"
            variant="ghost"
            size="sm"
            onClick={onMoveUp}
            disabled={disabled || !canMoveUp}
            aria-label={t('contactPhoneNumbersEditor.row.moveUp', {
              defaultValue: 'Move phone {{number}} up',
              number: index + 1,
            })}
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
            aria-label={t('contactPhoneNumbersEditor.row.moveDown', {
              defaultValue: 'Move phone {{number}} down',
              number: index + 1,
            })}
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
            aria-label={t('contactPhoneNumbersEditor.row.remove', {
              defaultValue: 'Remove phone {{number}}',
              number: index + 1,
            })}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(240px,0.9fr)] xl:items-start">
        <PhoneInput
          id={`${id}-phone-${index}`}
          label={t('contactPhoneNumbersEditor.fields.phoneNumber', {
            defaultValue: 'Phone Number',
          })}
          value={row.phone_number ?? ''}
          onChange={(value) => onChange({ phone_number: value })}
          onBlur={onBlur}
          countryCode={countryCode}
          phoneCode={phoneCode}
          countries={countries}
          onCountryChange={setCountryCode}
          allowExtensions={true}
          disabled={disabled}
          className="w-full"
          data-automation-id={`${id}-phone-${index}`}
        />
        <div className="space-y-1">
          <Label
            htmlFor={`${id}-type-${index}`}
            className="block text-gray-700"
          >
            {t('contactPhoneNumbersEditor.fields.phoneType', { defaultValue: 'Phone Type' })}
          </Label>
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
            options={phoneTypeOptions}
            disabled={disabled}
            className="h-[42px] rounded-md"
          />
          {typeValue === 'custom' && (
            <div className="space-y-1">
              <Label
                htmlFor={`${id}-custom-type-${index}`}
                className="block text-[rgb(var(--color-text-700))]"
              >
                {t('contactPhoneNumbersEditor.fields.customPhoneType', {
                  defaultValue: 'Custom Phone Type',
                })}
              </Label>
              <SearchableSelect
                id={`${id}-custom-type-${index}`}
                value={row.custom_type ?? ''}
                onChange={(value) => onChange({
                  canonical_type: null,
                  custom_type: value,
                })}
                options={customTypeOptions}
                placeholder={t('contactPhoneNumbersEditor.fields.customTypePlaceholder', {
                  defaultValue: 'Select or enter a custom phone type',
                })}
                searchPlaceholder={t('contactPhoneNumbersEditor.fields.customTypeSearchPlaceholder', {
                  defaultValue: 'Search or enter a custom phone type...',
                })}
                emptyMessage={t('contactPhoneNumbersEditor.fields.customTypeEmpty', {
                  defaultValue: 'No matching custom phone types.',
                })}
                allowCustomValue={true}
                customValueLabel={(value) => t('contactPhoneNumbersEditor.fields.customTypeUseValue', {
                  defaultValue: 'Use "{{value}}"',
                  value,
                })}
                disabled={disabled}
                className="h-[42px] rounded-md"
                dropdownMode="overlay"
                data-automation-id={`${id}-custom-type-${index}`}
              />
            </div>
          )}
        </div>
      </div>
    </Card>
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
  onCheckCustomTypeUsage?: (label: string) => Promise<{ label: string; usageCount: number }>;
  onDeleteOrphanedPhoneTypes?: (labels: string[]) => Promise<void>;
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
  onCheckCustomTypeUsage,
  onDeleteOrphanedPhoneTypes,
}) => {
  const { t } = useTranslation('msp/contacts');
  const createDraftRowsFromValue = useCallback((incomingValue: Array<ContactPhoneNumberInput | IContactPhoneNumber>) => {
    const existingRows = buildEditablePhoneRows(incomingValue);
    if (existingRows.length > 0 || allowEmpty) {
      return existingRows;
    }
    return [createEmptyPhoneRow(true)];
  }, [allowEmpty]);

  const [draftRows, setDraftRows] = useState<EditablePhoneRow[]>(() => createDraftRowsFromValue(value));
  const [touchedRowKeys, setTouchedRowKeys] = useState<Set<string>>(new Set());
  const lastEmittedSignatureRef = useRef<string | null>(null);
  const externalSignature = useMemo(
    () => buildPhoneRowsSignature(normalizeDraftContactPhoneNumbers(value)),
    [value]
  );
  const draftSignature = useMemo(
    () => buildPhoneRowsSignature(normalizeDraftContactPhoneNumbers(draftRows)),
    [draftRows]
  );

  useEffect(() => {
    if (
      externalSignature === lastEmittedSignatureRef.current ||
      externalSignature === draftSignature
    ) {
      return;
    }

    setDraftRows((previousRows) => {
      const syncedRows = buildEditablePhoneRows(value, previousRows);
      if (syncedRows.length > 0 || allowEmpty) {
        return syncedRows;
      }
      return [createEmptyPhoneRow(true)];
    });
  }, [allowEmpty, draftSignature, externalSignature, value]);

  const validationErrors = useMemo(
    () => translateContactPhoneValidationErrors(validateContactPhoneNumbers(draftRows), t),
    [draftRows, t]
  );
  const visibleValidationErrors = useMemo(
    () => getVisibleValidationErrors(validationErrors, draftRows, touchedRowKeys),
    [draftRows, touchedRowKeys, validationErrors]
  );

  useEffect(() => {
    if (onValidationChange) {
      onValidationChange(visibleValidationErrors);
    }
  }, [onValidationChange, visibleValidationErrors]);

  useEffect(() => {
    setTouchedRowKeys((previousTouchedRowKeys) => {
      if (previousTouchedRowKeys.size === 0) {
        return previousTouchedRowKeys;
      }

      const validRowKeys = new Set(draftRows.map((row, index) => getRowKey(row, index)));
      const nextTouchedRowKeys = new Set(
        Array.from(previousTouchedRowKeys).filter((rowKey) => validRowKeys.has(rowKey))
      );

      return nextTouchedRowKeys.size === previousTouchedRowKeys.size
        ? previousTouchedRowKeys
        : nextTouchedRowKeys;
    });
  }, [draftRows]);

  const displayedErrors = errorMessages ?? visibleValidationErrors;

  const commitRows = useCallback((nextRows: EditablePhoneRow[]) => {
    const normalizedRows = normalizeDraftContactPhoneNumbers(nextRows);
    lastEmittedSignatureRef.current = buildPhoneRowsSignature(normalizedRows);
    setDraftRows(nextRows);
    onChange(normalizedRows);
  }, [onChange]);

  const handleRowChange = (index: number, updates: Partial<EditablePhoneRow>) => {
    commitRows(
      draftRows.map((row, rowIndex) => rowIndex === index ? { ...row, ...updates } : row)
    );
  };

  const handleSetDefault = (index: number) => {
    commitRows(
      draftRows.map((row, rowIndex) => ({
        ...row,
        is_default: rowIndex === index,
      }))
    );
  };

  const handleRowBlur = (index: number) => {
    const row = draftRows[index];
    if (!row) {
      return;
    }

    const rowKey = getRowKey(row, index);
    setTouchedRowKeys((previousTouchedRowKeys) => {
      if (previousTouchedRowKeys.has(rowKey)) {
        return previousTouchedRowKeys;
      }

      const nextTouchedRowKeys = new Set(previousTouchedRowKeys);
      nextTouchedRowKeys.add(rowKey);
      return nextTouchedRowKeys;
    });
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    commitRows(moveContactPhoneRows(draftRows, index, direction));
  };

  const [pendingRemoveIndex, setPendingRemoveIndex] = useState<number | null>(null);
  const [pendingRemoveTypeLabel, setPendingRemoveTypeLabel] = useState('');
  const [showLastUsageDialog, setShowLastUsageDialog] = useState(false);

  const executeRemove = useCallback((index: number) => {
    const nextRows = draftRows.filter((_, rowIndex) => rowIndex !== index);
    if (nextRows.length === 0) {
      commitRows([]);
      return;
    }

    const hasDefault = nextRows.some((row) => row.is_default);
    commitRows(
      nextRows.map((row, rowIndex) => ({
        ...row,
        is_default: hasDefault ? row.is_default : rowIndex === 0,
        display_order: rowIndex,
      }))
    );
  }, [draftRows, commitRows]);

  const handleRemove = async (index: number) => {
    const row = draftRows[index];
    const customType = row.custom_type?.trim();

    // If row has a custom type and we have a usage check callback, check last usage
    if (customType && row.canonical_type === null && onCheckCustomTypeUsage) {
      try {
        const usage = await onCheckCustomTypeUsage(customType);
        if (usage.usageCount === 1) {
          setPendingRemoveIndex(index);
          setPendingRemoveTypeLabel(customType);
          setShowLastUsageDialog(true);
          return;
        }
      } catch {
        // If check fails, proceed with removal without dialog
      }
    }

    executeRemove(index);
  };

  const handleConfirmRemoveAndDeleteType = async () => {
    if (pendingRemoveIndex === null) return;
    try {
      executeRemove(pendingRemoveIndex);
      if (onDeleteOrphanedPhoneTypes) {
        await onDeleteOrphanedPhoneTypes([pendingRemoveTypeLabel]);
      }
    } finally {
      setShowLastUsageDialog(false);
      setPendingRemoveIndex(null);
      setPendingRemoveTypeLabel('');
    }
  };

  const handleRemoveAndKeepType = () => {
    if (pendingRemoveIndex === null) return;
    executeRemove(pendingRemoveIndex);
    setShowLastUsageDialog(false);
    setPendingRemoveIndex(null);
    setPendingRemoveTypeLabel('');
  };

  const handleAddPhone = () => {
    commitRows([
      ...draftRows,
      createEmptyPhoneRow(draftRows.length === 0),
    ]);
  };

  return (
    <div className="space-y-4" data-testid={id}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label className="text-sm font-medium text-gray-900">
            {t('contactPhoneNumbersEditor.title', { defaultValue: 'Phone Numbers' })}
          </Label>
          <p className="text-xs text-gray-500">
            {t('contactPhoneNumbersEditor.description', {
              defaultValue: 'Add one or more phone numbers and choose exactly one default.',
            })}
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
          {t('contactPhoneNumbersEditor.actions.addPhone', { defaultValue: 'Add phone' })}
        </Button>
      </div>

      {draftRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
          {t('contactPhoneNumbersEditor.empty', { defaultValue: 'No phone numbers yet.' })}
        </div>
      ) : (
        <div className="space-y-3">
          {draftRows.map((row, index) => (
            <ContactPhoneRow
              key={row.contact_phone_number_id ?? row._localId ?? `${index}`}
              id={id}
              index={index}
              row={row}
              countries={countries}
              customTypeSuggestions={customTypeSuggestions}
              disabled={disabled}
              canMoveUp={index > 0}
              canMoveDown={index < draftRows.length - 1}
              canRemove={draftRows.length > 0}
              onChange={(updates) => handleRowChange(index, updates)}
              onBlur={() => handleRowBlur(index)}
              onSetDefault={() => handleSetDefault(index)}
              onMoveUp={() => handleMove(index, -1)}
              onMoveDown={() => handleMove(index, 1)}
              onRemove={() => void handleRemove(index)}
            />
          ))}
        </div>
      )}

      {displayedErrors.length > 0 && (
        <Alert variant="destructive" className="py-3">
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-5">
              {displayedErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <ConfirmationDialog
        id={`${id}-last-phone-type-usage-dialog`}
        isOpen={showLastUsageDialog}
        onClose={() => {
          setShowLastUsageDialog(false);
          setPendingRemoveIndex(null);
          setPendingRemoveTypeLabel('');
        }}
        onConfirm={handleConfirmRemoveAndDeleteType}
        onCancel={handleRemoveAndKeepType}
        title={t('contactPhoneNumbersEditor.lastTypeUsage.title', {
          defaultValue: 'Last Phone Type Usage',
        })}
        message={t('contactPhoneNumbersEditor.lastTypeUsage.message', {
          defaultValue: 'This is the last use of custom phone type "{{label}}". Delete the type definition, or keep it for future use?',
          label: pendingRemoveTypeLabel,
        })}
        confirmLabel={t('contactPhoneNumbersEditor.lastTypeUsage.removeAndDelete', {
          defaultValue: 'Remove & Delete Type',
        })}
        thirdButtonLabel={t('contactPhoneNumbersEditor.lastTypeUsage.removeAndKeep', {
          defaultValue: 'Remove & Keep Type',
        })}
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
      />
    </div>
  );
};

export default ContactPhoneNumbersEditor;
