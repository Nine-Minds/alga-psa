import type { TemplateFieldDisplayFormat, TemplateValueFormat } from '@alga-psa/types';

type AddressRecord = Record<string, unknown>;

export type ResolvedFieldDisplayValue = {
  text: string | null;
  multiline: boolean;
};

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isNullish = (value: unknown): value is null | undefined => value === null || value === undefined;

const formatCurrency = (value: number, currencyCode: string) => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode || 'USD',
    }).format(value / 100);
  } catch {
    return `$${(value / 100).toFixed(2)}`;
  }
};

const formatDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString('en-US');
};

export const normalizeFieldFormat = (value: unknown): TemplateValueFormat => {
  const normalized = asTrimmedString(value).toLowerCase();
  if (normalized === 'number' || normalized === 'currency' || normalized === 'date') {
    return normalized;
  }
  return 'text';
};

const isAddressRecord = (value: unknown): value is AddressRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const splitAddressSegments = (input: string): string[] =>
  input
    .replace(/\r\n?/g, '\n')
    .split(/\n|,/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

const joinLocationLine = (city: string, state: string, postalCode: string): string => {
  const left = [city, state].filter(Boolean).join(city && state ? ', ' : '');
  if (left && postalCode) {
    return `${left} ${postalCode}`;
  }
  return left || postalCode;
};

const formatStructuredAddress = (value: AddressRecord, displayFormat: TemplateFieldDisplayFormat): ResolvedFieldDisplayValue => {
  const line1 =
    asTrimmedString(value.line1) ||
    asTrimmedString(value.address1) ||
    asTrimmedString(value.street1) ||
    asTrimmedString(value.street);
  const line2 =
    asTrimmedString(value.line2) ||
    asTrimmedString(value.address2) ||
    asTrimmedString(value.street2);
  const city = asTrimmedString(value.city);
  const state = asTrimmedString(value.state) || asTrimmedString(value.region) || asTrimmedString(value.province);
  const postalCode =
    asTrimmedString(value.postalCode) ||
    asTrimmedString(value.zip) ||
    asTrimmedString(value.zipCode);
  const country = asTrimmedString(value.country);
  const lines = [line1, line2, joinLocationLine(city, state, postalCode), country].filter(Boolean);
  if (lines.length === 0) {
    return { text: null, multiline: false };
  }
  if (displayFormat === 'multiline') {
    return { text: lines.join('\n'), multiline: true };
  }
  if (displayFormat === 'raw') {
    return { text: lines.join('\n'), multiline: true };
  }
  return { text: lines.join(', '), multiline: false };
};

const formatAddressValue = (
  value: unknown,
  displayFormat: TemplateFieldDisplayFormat
): ResolvedFieldDisplayValue => {
  if (isNullish(value)) {
    return { text: null, multiline: false };
  }
  if (isAddressRecord(value)) {
    return formatStructuredAddress(value, displayFormat);
  }
  if (typeof value !== 'string') {
    return { text: String(value), multiline: false };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { text: null, multiline: false };
  }
  if (displayFormat === 'raw') {
    return { text: trimmed, multiline: trimmed.includes('\n') };
  }
  const parts = splitAddressSegments(trimmed);
  if (parts.length === 0) {
    return { text: null, multiline: false };
  }
  if (displayFormat === 'multiline') {
    return { text: parts.join('\n'), multiline: true };
  }
  return { text: parts.join(', '), multiline: false };
};

const formatPrimitiveValue = (
  value: unknown,
  format: TemplateValueFormat,
  currencyCode: string
): ResolvedFieldDisplayValue => {
  if (isNullish(value)) {
    return { text: null, multiline: false };
  }
  if (typeof value === 'string') {
    if (value.length === 0) {
      return { text: null, multiline: false };
    }
    if (format === 'date') {
      return { text: formatDate(value), multiline: false };
    }
    if (format === 'number') {
      const asNumber = Number(value);
      const text = Number.isFinite(asNumber) ? String(asNumber) : value;
      return { text, multiline: text.includes('\n') };
    }
    if (format === 'currency') {
      const asNumber = Number(value);
      const text = Number.isFinite(asNumber) ? formatCurrency(asNumber, currencyCode) : value;
      return { text, multiline: text.includes('\n') };
    }
    return { text: value, multiline: value.includes('\n') };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { text: null, multiline: false };
    }
    if (format === 'currency') {
      return { text: formatCurrency(value, currencyCode), multiline: false };
    }
    if (format === 'date') {
      return { text: formatDate(String(value)), multiline: false };
    }
    return { text: String(value), multiline: false };
  }
  if (typeof value === 'boolean') {
    return { text: value ? 'Yes' : 'No', multiline: false };
  }
  return { text: null, multiline: false };
};

export const formatTemplateFieldValue = (params: {
  value: unknown;
  format: unknown;
  currencyCode: string;
  displayFormat?: TemplateFieldDisplayFormat | null;
}): ResolvedFieldDisplayValue => {
  const normalizedFormat = normalizeFieldFormat(params.format);
  const displayFormat = params.displayFormat;
  if (displayFormat === 'single-line' || displayFormat === 'multiline' || displayFormat === 'raw') {
    return formatAddressValue(params.value, displayFormat);
  }
  return formatPrimitiveValue(params.value, normalizedFormat, params.currencyCode);
};
