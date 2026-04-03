'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ContactEmailAddressInput,
  ContactEmailCanonicalType,
  IContactEmailAddress,
} from '@alga-psa/types';
import { CONTACT_EMAIL_CANONICAL_TYPES } from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import SearchableSelect from '@alga-psa/ui/components/SearchableSelect';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';

type EditableAdditionalEmailRow = ContactEmailAddressInput & {
  _localId?: string;
};

type ContactEmailRowInput = ContactEmailAddressInput | IContactEmailAddress;

export type ContactEmailAddressesEditorValue = {
  email?: string | null;
  primary_email_canonical_type?: ContactEmailCanonicalType | null;
  primary_email_custom_type?: string | null;
  primary_email_custom_type_id?: string | null;
  primary_email_type?: string | null;
  additional_email_addresses?: ContactEmailRowInput[];
};

export type ContactEmailAddressesEditorChange = {
  email: string;
  primary_email_canonical_type: ContactEmailCanonicalType | null;
  primary_email_custom_type: string | null;
  additional_email_addresses: ContactEmailAddressInput[];
};

type NormalizedContactEmailAddresses = ContactEmailAddressesEditorChange;

const CANONICAL_EMAIL_TYPE_OPTIONS = CONTACT_EMAIL_CANONICAL_TYPES.map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}));

const EMAIL_TYPE_OPTIONS = [
  ...CANONICAL_EMAIL_TYPE_OPTIONS,
  { value: 'custom', label: 'Custom' },
];

const EMAIL_ROW_ERROR_PATTERN = /^Additional email (\d+):/;
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeCustomTypeLabel(label: string | null | undefined): string {
  return (label ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeEmailAddress(emailAddress: string | null | undefined): string {
  return (emailAddress ?? '').trim().toLowerCase();
}

function createRowLocalId(index: number): string {
  return `email-row-${index}-${Math.random().toString(36).slice(2, 9)}`;
}

function isCanonicalEmailType(value: string | null | undefined): value is ContactEmailCanonicalType {
  return CONTACT_EMAIL_CANONICAL_TYPES.includes((value ?? '') as ContactEmailCanonicalType);
}

function normalizeAdditionalEmailRowForDraft(
  row: ContactEmailRowInput,
  index: number,
  localId?: string
): EditableAdditionalEmailRow {
  const isCustomType = row.canonical_type === null;
  const customType = isCustomType ? (row.custom_type ?? '') : null;

  return {
    contact_additional_email_address_id: row.contact_additional_email_address_id,
    email_address: row.email_address ?? '',
    canonical_type: isCustomType ? null : row.canonical_type ?? 'work',
    custom_type: customType,
    display_order: row.display_order ?? index,
    _localId: localId ?? row.contact_additional_email_address_id ?? createRowLocalId(index),
  };
}

function buildEditableAdditionalEmailRows(
  rows: Array<ContactEmailRowInput | EditableAdditionalEmailRow>,
  previousRows: EditableAdditionalEmailRow[] = []
): EditableAdditionalEmailRow[] {
  return rows.map((row, index) => {
    const previousRow = previousRows.find((candidate) => {
      if (row.contact_additional_email_address_id && candidate.contact_additional_email_address_id) {
        return candidate.contact_additional_email_address_id === row.contact_additional_email_address_id;
      }

      return candidate.display_order === (row.display_order ?? index);
    });

    return normalizeAdditionalEmailRowForDraft(row, index, previousRow?._localId);
  });
}

function createEmptyAdditionalEmailRow(): EditableAdditionalEmailRow {
  return {
    email_address: '',
    canonical_type: 'work',
    custom_type: null,
    display_order: 0,
    _localId: createRowLocalId(0),
  };
}

export function normalizeDraftContactEmailAddresses(
  value: ContactEmailAddressesEditorValue
): NormalizedContactEmailAddresses {
  const primaryEmail = value.email?.trim() ?? '';
  const primaryCustomType = value.primary_email_custom_type?.trim()
    ?? (value.primary_email_canonical_type === null ? value.primary_email_type?.trim() ?? '' : '');
  const primaryIsCustom = Boolean(
    value.primary_email_canonical_type === null
    || primaryCustomType
    || value.primary_email_custom_type_id
  );

  return {
    email: primaryEmail,
    primary_email_canonical_type: primaryIsCustom ? null : (value.primary_email_canonical_type ?? 'work'),
    primary_email_custom_type: primaryIsCustom ? (primaryCustomType || null) : null,
    additional_email_addresses: (value.additional_email_addresses ?? []).map((row, index) => {
      const isCustomType = row.canonical_type === null;
      return {
        contact_additional_email_address_id: row.contact_additional_email_address_id,
        email_address: row.email_address?.trim() ?? '',
        canonical_type: isCustomType ? null : row.canonical_type ?? 'work',
        custom_type: isCustomType ? (row.custom_type?.trim() ?? '') : null,
        display_order: index,
      };
    }),
  };
}

export function compactContactEmailAddresses(
  value: ContactEmailAddressesEditorValue
): ContactEmailAddressesEditorChange {
  const normalized = normalizeDraftContactEmailAddresses(value);
  return {
    ...normalized,
    additional_email_addresses: normalized.additional_email_addresses
      .filter((row) => {
        const emailAddress = row.email_address?.trim() ?? '';
        const customType = row.custom_type?.trim() ?? '';
        const canonicalType = row.canonical_type ?? null;
        return Boolean(emailAddress || customType || canonicalType);
      })
      .map((row, index) => ({
        ...row,
        display_order: index,
      })),
  };
}

export function moveContactEmailRows(
  rows: EditableAdditionalEmailRow[],
  index: number,
  direction: -1 | 1
): EditableAdditionalEmailRow[] {
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

export function promoteContactEmailRow(
  value: ContactEmailAddressesEditorValue,
  index: number
): ContactEmailAddressesEditorChange {
  const normalized = compactContactEmailAddresses(value);
  const rowToPromote = normalized.additional_email_addresses[index];
  if (!rowToPromote) {
    return normalized;
  }

  const remainingRows = normalized.additional_email_addresses.filter((_, rowIndex) => rowIndex !== index);
  return {
    email: rowToPromote.email_address,
    primary_email_canonical_type: rowToPromote.canonical_type ?? null,
    primary_email_custom_type: rowToPromote.custom_type?.trim() || null,
    additional_email_addresses: [
      ...remainingRows,
      {
        email_address: normalized.email,
        canonical_type: normalized.primary_email_canonical_type,
        custom_type: normalized.primary_email_custom_type,
        display_order: remainingRows.length,
      },
    ],
  };
}

export function validateContactEmailAddresses(
  value: ContactEmailAddressesEditorValue
): string[] {
  const normalized = compactContactEmailAddresses(value);
  const errors: string[] = [];
  const normalizedPrimaryEmail = normalizeEmailAddress(normalized.email);

  if (!normalized.email) {
    errors.push('Primary email: Enter an email address.');
  } else if (!EMAIL_ADDRESS_PATTERN.test(normalized.email)) {
    errors.push('Primary email: Enter a valid email address.');
  }

  if (normalized.primary_email_canonical_type === null) {
    const primaryCustomType = normalized.primary_email_custom_type?.trim() ?? '';
    if (!primaryCustomType) {
      errors.push('Primary email: Enter a custom email label.');
    } else if (isCanonicalEmailType(normalizeCustomTypeLabel(primaryCustomType))) {
      errors.push('Primary email: Use the canonical type picker for this label.');
    }
  }

  const seenAdditionalEmails = new Set<string>();

  normalized.additional_email_addresses.forEach((row, index) => {
    const rowLabel = `Additional email ${index + 1}`;
    const normalizedRowEmail = normalizeEmailAddress(row.email_address);

    if (!row.email_address) {
      errors.push(`${rowLabel}: Enter an email address.`);
    } else if (!EMAIL_ADDRESS_PATTERN.test(row.email_address)) {
      errors.push(`${rowLabel}: Enter a valid email address.`);
    } else if (normalizedRowEmail === normalizedPrimaryEmail) {
      errors.push(`${rowLabel}: Additional email cannot match the primary email.`);
    } else if (seenAdditionalEmails.has(normalizedRowEmail)) {
      errors.push(`${rowLabel}: Additional email addresses must be unique.`);
    } else {
      seenAdditionalEmails.add(normalizedRowEmail);
    }

    if (row.canonical_type === null) {
      const customType = row.custom_type?.trim() ?? '';
      if (!customType) {
        errors.push(`${rowLabel}: Enter a custom email label.`);
        return;
      }

      const normalizedCustomType = normalizeCustomTypeLabel(customType);
      if (isCanonicalEmailType(normalizedCustomType)) {
        errors.push(`${rowLabel}: Use the canonical type picker for this label.`);
      }
    }
  });

  return Array.from(new Set(errors));
}

function buildContactEmailAddressesSignature(
  value: ContactEmailAddressesEditorChange
): string {
  return JSON.stringify(value);
}

function getRowKey(row: EditableAdditionalEmailRow, index: number): string {
  if (row.contact_additional_email_address_id) {
    return `persisted:${row.contact_additional_email_address_id}`;
  }

  return `local:${row._localId ?? `${index}`}`;
}

function getEmailRowLabel(row: ContactEmailRowInput): string {
  if (row.canonical_type === null) {
    return row.custom_type?.trim() || 'Custom';
  }

  const canonicalType = row.canonical_type ?? 'work';
  return canonicalType.charAt(0).toUpperCase() + canonicalType.slice(1);
}

function getVisibleValidationErrors(
  errors: string[],
  rows: EditableAdditionalEmailRow[],
  touchedRowKeys: Set<string>
): string[] {
  if (touchedRowKeys.size === 0) {
    return [];
  }

  return errors.filter((error) => {
    const match = EMAIL_ROW_ERROR_PATTERN.exec(error);
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

function buildCustomTypeOptions(customTypeSuggestions: string[]): Array<{ value: string; label: string }> {
  return Array.from(
    new Map(
      customTypeSuggestions
        .map((suggestion) => suggestion.trim())
        .filter(Boolean)
        .map((suggestion) => [normalizeCustomTypeLabel(suggestion), suggestion] as const)
    ).values()
  ).map((suggestion) => ({
    value: suggestion,
    label: suggestion,
  }));
}

interface ContactEmailRowProps {
  id: string;
  index: number;
  row: EditableAdditionalEmailRow;
  customTypeSuggestions: string[];
  disabled?: boolean;
  compact?: boolean;
  isExpanded?: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (updates: Partial<EditableAdditionalEmailRow>) => void;
  onBlur: () => void;
  onToggleExpanded?: () => void;
  onPromote: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

const ContactAdditionalEmailRow: React.FC<ContactEmailRowProps> = ({
  id,
  index,
  row,
  customTypeSuggestions,
  disabled = false,
  compact = false,
  isExpanded = true,
  canMoveUp,
  canMoveDown,
  onChange,
  onBlur,
  onToggleExpanded,
  onPromote,
  onMoveUp,
  onMoveDown,
  onRemove,
}) => {
  const typeValue = row.canonical_type === null ? 'custom' : row.canonical_type ?? 'work';
  const summaryLabel = getEmailRowLabel(row);
  const summaryEmail = row.email_address?.trim() || 'No email entered yet';
  const customTypeOptions = useMemo(
    () => buildCustomTypeOptions(customTypeSuggestions),
    [customTypeSuggestions]
  );

  if (compact && !isExpanded) {
    return (
      <Card className="border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-surface-50,255_255_255))] p-3" data-testid={`${id}-row-${index}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-[rgb(var(--color-primary-50))] px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-[rgb(var(--color-primary-700))]">
                {summaryLabel}
              </span>
              <span className="text-xs text-[rgb(var(--color-text-500))]">
                Additional email {index + 1}
              </span>
            </div>
            <div className="truncate text-sm font-medium text-[rgb(var(--color-text-900))]">
              {summaryEmail}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Button
              id={`${id}-promote-${index}`}
              type="button"
              variant="secondary"
              size="sm"
              onClick={onPromote}
              disabled={disabled}
            >
              Make Default
            </Button>
            <Button
              id={`${id}-toggle-${index}`}
              type="button"
              variant="outline"
              size="sm"
              onClick={onToggleExpanded}
              disabled={disabled}
              className="inline-flex items-center gap-1.5"
            >
              <ChevronDown className="h-4 w-4" />
              Edit
            </Button>
            <Button
              id={`${id}-move-up-${index}`}
              type="button"
              variant="ghost"
              size="sm"
              onClick={onMoveUp}
              disabled={disabled || !canMoveUp}
              aria-label={`Move additional email ${index + 1} up`}
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
              aria-label={`Move additional email ${index + 1} down`}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button
              id={`${id}-remove-${index}`}
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={disabled}
              aria-label={`Remove additional email ${index + 1}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4" data-testid={`${id}-row-${index}`}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div>
          <div className="text-sm font-medium text-[rgb(var(--color-text-900))]">Additional email {index + 1}</div>
          <div className="text-xs text-muted-foreground">Stored as a non-default email address</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button
            id={`${id}-promote-${index}`}
            type="button"
            variant="secondary"
            size="sm"
            onClick={onPromote}
            disabled={disabled}
          >
            Make Default
          </Button>
          {compact && (
            <Button
              id={`${id}-toggle-${index}`}
              type="button"
              variant="outline"
              size="sm"
              onClick={onToggleExpanded}
              disabled={disabled}
              className="inline-flex items-center gap-1.5"
            >
              <ChevronUp className="h-4 w-4" />
              Done
            </Button>
          )}
          <Button
            id={`${id}-move-up-${index}`}
            type="button"
            variant="ghost"
            size="sm"
            onClick={onMoveUp}
            disabled={disabled || !canMoveUp}
            aria-label={`Move additional email ${index + 1} up`}
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
            aria-label={`Move additional email ${index + 1} down`}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button
            id={`${id}-remove-${index}`}
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`Remove additional email ${index + 1}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(240px,0.9fr)] xl:items-start">
        <div className="space-y-1">
          <Label htmlFor={`${id}-email-${index}`} className="block text-gray-700">
            Email Address
          </Label>
          <Input
            id={`${id}-email-${index}`}
            type="email"
            value={row.email_address ?? ''}
            onChange={(event) => onChange({ email_address: event.target.value })}
            onBlur={onBlur}
            placeholder="name@example.com"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-type-${index}`} className="block text-gray-700">
            Email Label
          </Label>
          <CustomSelect
            id={`${id}-type-${index}`}
            value={typeValue}
            onValueChange={(nextValue) => {
              if (nextValue === 'custom') {
                onChange({ canonical_type: null, custom_type: row.custom_type ?? '' });
                return;
              }

              onChange({
                canonical_type: nextValue as ContactEmailCanonicalType,
                custom_type: null,
              });
            }}
            options={EMAIL_TYPE_OPTIONS}
            disabled={disabled}
            className="h-[42px] rounded-md"
          />
          {typeValue === 'custom' && (
            <div className="space-y-1">
              <Label htmlFor={`${id}-custom-type-${index}`} className="block text-[rgb(var(--color-text-700))]">
                Custom Email Label
              </Label>
              <SearchableSelect
                id={`${id}-custom-type-${index}`}
                value={row.custom_type ?? ''}
                onChange={(nextValue) => onChange({ canonical_type: null, custom_type: nextValue })}
                options={customTypeOptions}
                placeholder="Select or enter a custom email label"
                searchPlaceholder="Search or enter a custom email label..."
                emptyMessage="No matching custom email labels."
                allowCustomValue={true}
                customValueLabel={(nextValue) => `Use "${nextValue}"`}
                disabled={disabled}
                className="h-[42px] rounded-md"
                dropdownMode="overlay"
              />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};

interface ContactEmailAddressesEditorProps {
  id: string;
  /** When set, used as the DOM id for the primary email input (default: `${id}-primary-email`). */
  primaryEmailInputId?: string;
  compactAdditionalRows?: boolean;
  value: ContactEmailAddressesEditorValue;
  onChange: (value: ContactEmailAddressesEditorChange) => void;
  customTypeSuggestions?: string[];
  disabled?: boolean;
  errorMessages?: string[];
  onValidationChange?: (errors: string[]) => void;
}

const ContactEmailAddressesEditor: React.FC<ContactEmailAddressesEditorProps> = ({
  id,
  primaryEmailInputId,
  compactAdditionalRows = false,
  value,
  onChange,
  customTypeSuggestions = [],
  disabled = false,
  errorMessages,
  onValidationChange,
}) => {
  const primaryEmailDomId = primaryEmailInputId ?? `${id}-primary-email`;
  const normalizedValue = useMemo(() => normalizeDraftContactEmailAddresses(value), [value]);
  const [primaryEmail, setPrimaryEmail] = useState(normalizedValue.email);
  const [primaryCanonicalType, setPrimaryCanonicalType] = useState<ContactEmailCanonicalType | null>(
    normalizedValue.primary_email_canonical_type
  );
  const [primaryCustomType, setPrimaryCustomType] = useState(normalizedValue.primary_email_custom_type);
  const [draftRows, setDraftRows] = useState<EditableAdditionalEmailRow[]>(
    () => buildEditableAdditionalEmailRows(normalizedValue.additional_email_addresses)
  );
  const [touchedRowKeys, setTouchedRowKeys] = useState<Set<string>>(new Set());
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const lastEmittedSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    const externalSignature = buildContactEmailAddressesSignature(normalizedValue);
    if (externalSignature === lastEmittedSignatureRef.current) {
      return;
    }

    setPrimaryEmail(normalizedValue.email);
    setPrimaryCanonicalType(normalizedValue.primary_email_canonical_type);
    setPrimaryCustomType(normalizedValue.primary_email_custom_type);
    setDraftRows((previousRows) => buildEditableAdditionalEmailRows(normalizedValue.additional_email_addresses, previousRows));
  }, [normalizedValue]);

  const currentValue = useMemo<ContactEmailAddressesEditorChange>(() => ({
    email: primaryEmail,
    primary_email_canonical_type: primaryCanonicalType,
    primary_email_custom_type: primaryCanonicalType === null ? (primaryCustomType?.trim() || null) : null,
    additional_email_addresses: draftRows.map((row, index) => ({
      contact_additional_email_address_id: row.contact_additional_email_address_id,
      email_address: row.email_address?.trim() ?? '',
      canonical_type: row.canonical_type === null ? null : row.canonical_type ?? 'work',
      custom_type: row.canonical_type === null ? (row.custom_type?.trim() || '') : null,
      display_order: index,
    })),
  }), [draftRows, primaryCanonicalType, primaryCustomType, primaryEmail]);

  const validationErrors = useMemo(
    () => validateContactEmailAddresses(currentValue),
    [currentValue]
  );
  const visibleValidationErrors = useMemo(
    () => getVisibleValidationErrors(validationErrors, draftRows, touchedRowKeys),
    [draftRows, touchedRowKeys, validationErrors]
  );
  const displayedErrors = errorMessages ?? visibleValidationErrors;
  const primaryCustomTypeOptions = useMemo(
    () => buildCustomTypeOptions(customTypeSuggestions),
    [customTypeSuggestions]
  );

  useEffect(() => {
    if (onValidationChange) {
      onValidationChange(validationErrors);
    }
  }, [onValidationChange, validationErrors]);

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

  useEffect(() => {
    if (!compactAdditionalRows) {
      return;
    }

    setExpandedRowKey((previousExpandedRowKey) => {
      if (!previousExpandedRowKey) {
        return previousExpandedRowKey;
      }

      const rowKeyStillExists = draftRows.some((row, index) => getRowKey(row, index) === previousExpandedRowKey);
      return rowKeyStillExists ? previousExpandedRowKey : null;
    });
  }, [compactAdditionalRows, draftRows]);

  const commitValue = (
    nextPrimaryEmail: string,
    nextPrimaryCanonicalType: ContactEmailCanonicalType | null,
    nextPrimaryCustomType: string | null,
    nextRows: EditableAdditionalEmailRow[]
  ) => {
    const nextValue = compactContactEmailAddresses({
      email: nextPrimaryEmail,
      primary_email_canonical_type: nextPrimaryCanonicalType,
      primary_email_custom_type: nextPrimaryCustomType,
      additional_email_addresses: nextRows,
    });

    lastEmittedSignatureRef.current = buildContactEmailAddressesSignature(nextValue);
    setPrimaryEmail(nextValue.email);
    setPrimaryCanonicalType(nextValue.primary_email_canonical_type);
    setPrimaryCustomType(nextValue.primary_email_custom_type);
    setDraftRows(buildEditableAdditionalEmailRows(nextValue.additional_email_addresses, nextRows));
    onChange(nextValue);
  };

  const handlePrimaryEmailChange = (nextEmail: string) => {
    commitValue(nextEmail, primaryCanonicalType, primaryCustomType, draftRows);
  };

  const handlePrimaryTypeChange = (nextValue: string) => {
    if (nextValue === 'custom') {
      commitValue(primaryEmail, null, primaryCustomType ?? '', draftRows);
      return;
    }

    commitValue(primaryEmail, nextValue as ContactEmailCanonicalType, null, draftRows);
  };

  const handlePrimaryCustomTypeChange = (nextValue: string) => {
    commitValue(primaryEmail, null, nextValue, draftRows);
  };

  const handleAdditionalRowChange = (index: number, updates: Partial<EditableAdditionalEmailRow>) => {
    const nextRows = draftRows.map((row, rowIndex) => rowIndex === index ? { ...row, ...updates } : row);
    commitValue(primaryEmail, primaryCanonicalType, primaryCustomType, nextRows);
  };

  const handleAdditionalRowBlur = (index: number) => {
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

  const handlePromote = (index: number) => {
    const promoted = promoteContactEmailRow(currentValue, index);
    commitValue(
      promoted.email,
      promoted.primary_email_canonical_type,
      promoted.primary_email_custom_type,
      buildEditableAdditionalEmailRows(promoted.additional_email_addresses)
    );
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    commitValue(primaryEmail, primaryCanonicalType, primaryCustomType, moveContactEmailRows(draftRows, index, direction));
  };

  const handleRemove = (index: number) => {
    commitValue(
      primaryEmail,
      primaryCanonicalType,
      primaryCustomType,
      draftRows
        .filter((_, rowIndex) => rowIndex !== index)
        .map((row, rowIndex) => ({
          ...row,
          display_order: rowIndex,
        }))
    );
  };

  const handleAdd = () => {
    const newRow: EditableAdditionalEmailRow = {
      ...createEmptyAdditionalEmailRow(),
      display_order: draftRows.length,
    };

    if (compactAdditionalRows) {
      setExpandedRowKey(getRowKey(newRow, draftRows.length));
    }

    commitValue(
      primaryEmail,
      primaryCanonicalType,
      primaryCustomType,
      [
        ...draftRows,
        newRow,
      ]
    );
  };

  const primaryTypeValue = primaryCanonicalType === null ? 'custom' : primaryCanonicalType ?? 'work';

  return (
    <div className="space-y-4">
      <Card className="p-4" data-testid={`${id}-primary-row`}>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <div className="text-sm font-medium text-[rgb(var(--color-text-900))]">Primary email</div>
            <div className="text-xs text-muted-foreground">This remains the default address stored on the contact record</div>
          </div>
          <div className="rounded-full bg-[rgb(var(--color-primary-100))] px-3 py-1 text-xs font-medium text-[rgb(var(--color-primary-700))]">
            Default
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(240px,0.9fr)] xl:items-start">
          <div className="space-y-1">
            <Label htmlFor={primaryEmailDomId} className="block text-gray-700">
              Email Address
            </Label>
            <Input
              id={primaryEmailDomId}
              type="email"
              value={primaryEmail}
              onChange={(event) => handlePrimaryEmailChange(event.target.value)}
              placeholder="name@example.com"
              disabled={disabled}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-primary-type`} className="block text-gray-700">
              Email Label
            </Label>
            <CustomSelect
              id={`${id}-primary-type`}
              value={primaryTypeValue}
              onValueChange={handlePrimaryTypeChange}
              options={EMAIL_TYPE_OPTIONS}
              disabled={disabled}
              className="h-[42px] rounded-md"
            />
            {primaryTypeValue === 'custom' && (
              <div className="space-y-1">
                <Label htmlFor={`${id}-primary-custom-type`} className="block text-[rgb(var(--color-text-700))]">
                  Custom Email Label
                </Label>
                <SearchableSelect
                  id={`${id}-primary-custom-type`}
                  value={primaryCustomType ?? ''}
                  onChange={handlePrimaryCustomTypeChange}
                  options={primaryCustomTypeOptions}
                  placeholder="Select or enter a custom email label"
                  searchPlaceholder="Search or enter a custom email label..."
                  emptyMessage="No matching custom email labels."
                  allowCustomValue={true}
                  customValueLabel={(nextValue) => `Use "${nextValue}"`}
                  disabled={disabled}
                  className="h-[42px] rounded-md"
                  dropdownMode="overlay"
                />
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        {draftRows.map((row, index) => (
          <ContactAdditionalEmailRow
            key={getRowKey(row, index)}
            id={`${id}-additional`}
            index={index}
            row={row}
            customTypeSuggestions={customTypeSuggestions}
            disabled={disabled}
            compact={compactAdditionalRows}
            isExpanded={!compactAdditionalRows || expandedRowKey === getRowKey(row, index)}
            canMoveUp={index > 0}
            canMoveDown={index < draftRows.length - 1}
            onChange={(updates) => handleAdditionalRowChange(index, updates)}
            onBlur={() => handleAdditionalRowBlur(index)}
            onToggleExpanded={() => {
              const rowKey = getRowKey(row, index);
              setExpandedRowKey((previousExpandedRowKey) => previousExpandedRowKey === rowKey ? null : rowKey);
            }}
            onPromote={() => handlePromote(index)}
            onMoveUp={() => handleMove(index, -1)}
            onMoveDown={() => handleMove(index, 1)}
            onRemove={() => handleRemove(index)}
          />
        ))}

        <Button
          id={`${id}-add`}
          type="button"
          variant="secondary"
          onClick={handleAdd}
          disabled={disabled}
          className="inline-flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Email
        </Button>
      </div>

      {displayedErrors.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc pl-5">
              {displayedErrors.map((errorMessage) => (
                <li key={errorMessage}>{errorMessage}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

export default ContactEmailAddressesEditor;
