import { ImportValidationError } from '@/lib/imports/errors';
import type { FieldValidator, ParsedRecord, FieldValueParser } from '@/types/imports.types';

const MAC_REGEX = /^([0-9A-F]{2}[-:]?){6}$/i;
const IP_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(?:\.(?!$)|$)){4}$/;

const isEmpty = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
};

export const createMacAddressValidator = (field: string, label: string): FieldValidator => {
  return (value: unknown, record: ParsedRecord) => {
    if (isEmpty(value)) {
      return null;
    }

    if (typeof value !== 'string' || !MAC_REGEX.test(value)) {
      return new ImportValidationError(
        record.rowNumber,
        field,
        value,
        `${label} must be a valid MAC address (e.g., 00:11:22:33:44:55)`
      );
    }

    return null;
  };
};

export const createMacAddressParser = (label: string): FieldValueParser => {
  return (value: unknown) => {
    if (isEmpty(value)) {
      return null;
    }

    if (typeof value !== 'string') {
      throw new Error(`${label} must be provided as text`);
    }

    const normalized = value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (normalized.length !== 12) {
      throw new Error(`${label} must contain 12 hexadecimal characters`);
    }

    const pairs = normalized.match(/.{1,2}/g) ?? [];
    return pairs.join(':');
  };
};

export const createIpAddressValidator = (field: string, label: string): FieldValidator => {
  return (value: unknown, record: ParsedRecord) => {
    if (isEmpty(value)) {
      return null;
    }

    if (typeof value !== 'string' || !IP_REGEX.test(value.trim())) {
      return new ImportValidationError(
        record.rowNumber,
        field,
        value,
        `${label} must be a valid IPv4 address`
      );
    }

    return null;
  };
};

export const createEnumValidator = (
  field: string,
  label: string,
  allowedValues: readonly string[]
): FieldValidator => {
  const normalizedValues = allowedValues.map((value) => value.toLowerCase());
  return (value: unknown, record: ParsedRecord) => {
    if (isEmpty(value)) {
      return null;
    }

    if (typeof value !== 'string') {
      return new ImportValidationError(
        record.rowNumber,
        field,
        value,
        `${label} must be one of: ${allowedValues.join(', ')}`
      );
    }

    if (!normalizedValues.includes(value.toLowerCase())) {
      return new ImportValidationError(
        record.rowNumber,
        field,
        value,
        `${label} must be one of: ${allowedValues.join(', ')}`
      );
    }

    return null;
  };
};

export const createMaxLengthValidator = (field: string, label: string, maxLength: number): FieldValidator => {
  return (value: unknown, record: ParsedRecord) => {
    if (isEmpty(value)) {
      return null;
    }

    if (typeof value !== 'string') {
      return new ImportValidationError(
        record.rowNumber,
        field,
        value,
        `${label} must be provided as text`
      );
    }

    if (value.length > maxLength) {
      return new ImportValidationError(
        record.rowNumber,
        field,
        value,
        `${label} must be ${maxLength} characters or fewer`
      );
    }

    return null;
  };
};

export const createDateParser = (label: string): FieldValueParser => {
  return (value: unknown) => {
    if (isEmpty(value)) {
      return null;
    }

    if (value instanceof Date) {
      if (isNaN(value.getTime())) {
        throw new Error(`${label} is not a valid date`);
      }
      return value.toISOString();
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      const parsed = new Date(trimmed);
      if (isNaN(parsed.getTime())) {
        throw new Error(`${label} is not a valid date`);
      }
      return parsed.toISOString();
    }

    throw new Error(`${label} must be a valid date string`);
  };
};

export const createToUpperCaseParser = (): FieldValueParser => {
  return (value: unknown) => {
    if (isEmpty(value)) {
      return null;
    }
    if (typeof value !== 'string') {
      return value;
    }
    return value.trim().toUpperCase();
  };
};
