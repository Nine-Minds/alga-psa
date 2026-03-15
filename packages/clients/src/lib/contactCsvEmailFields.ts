import type {
  ContactEmailAddressInput,
  ContactEmailCanonicalType,
  IContact,
} from '@alga-psa/types';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CANONICAL_EMAIL_TYPES: ReadonlyArray<ContactEmailCanonicalType> = ['work', 'personal', 'billing', 'other'];

export function normalizeContactCsvEmailValue(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim().toLowerCase();
  return trimmedValue ? trimmedValue : null;
}

export function isValidContactCsvEmailValue(value: string | null | undefined): boolean {
  const normalizedValue = normalizeContactCsvEmailValue(value);
  return Boolean(normalizedValue && EMAIL_REGEX.test(normalizedValue));
}

export function parseContactCsvEmailType(
  rawValue: string | null | undefined
): {
  canonicalType?: ContactEmailCanonicalType | null;
  customType?: string | null;
} {
  const trimmedValue = rawValue?.trim();
  if (!trimmedValue) {
    return {};
  }

  const normalizedValue = trimmedValue.toLowerCase();
  if (CANONICAL_EMAIL_TYPES.includes(normalizedValue as ContactEmailCanonicalType)) {
    return {
      canonicalType: normalizedValue as ContactEmailCanonicalType,
      customType: null,
    };
  }

  return {
    canonicalType: null,
    customType: trimmedValue,
  };
}

export function formatContactCsvPrimaryEmailType(
  contact: Pick<IContact, 'primary_email_canonical_type' | 'primary_email_type'>
): string {
  return contact.primary_email_type?.trim() || contact.primary_email_canonical_type || 'work';
}

export function formatContactCsvAdditionalEmailAddresses(
  rows: Array<Pick<ContactEmailAddressInput, 'email_address' | 'canonical_type' | 'custom_type'>> | undefined
): string {
  if (!rows?.length) {
    return '';
  }

  return rows
    .map((row) => {
      const label = row.custom_type?.trim() || row.canonical_type || 'other';
      return `${label}: ${row.email_address}`;
    })
    .join(' | ');
}

export function parseContactCsvAdditionalEmailAddresses(
  rawValue: string | null | undefined,
  primaryEmail?: string | null
): {
  rows: ContactEmailAddressInput[];
  errors: string[];
} {
  const trimmedValue = rawValue?.trim();
  if (!trimmedValue) {
    return {
      rows: [],
      errors: [],
    };
  }

  const errors: string[] = [];
  const rows: ContactEmailAddressInput[] = [];
  const seenEmails = new Set<string>();
  const normalizedPrimaryEmail = normalizeContactCsvEmailValue(primaryEmail);

  const entries = trimmedValue
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean);

  entries.forEach((entry, index) => {
    const separatorIndex = entry.indexOf(':');
    if (separatorIndex <= 0) {
      errors.push(`Additional email ${index + 1}: Use the format "label:email@example.com"`);
      return;
    }

    const rawLabel = entry.slice(0, separatorIndex).trim();
    const rawEmail = entry.slice(separatorIndex + 1).trim();
    if (!rawLabel) {
      errors.push(`Additional email ${index + 1}: Enter an email label before the colon`);
      return;
    }

    const normalizedEmail = normalizeContactCsvEmailValue(rawEmail);
    if (!normalizedEmail || !isValidContactCsvEmailValue(normalizedEmail)) {
      errors.push(`Additional email ${index + 1}: Enter a valid email address`);
      return;
    }

    if (normalizedPrimaryEmail && normalizedEmail === normalizedPrimaryEmail) {
      errors.push(`Additional email ${index + 1}: Additional email address cannot match the primary email`);
      return;
    }

    if (seenEmails.has(normalizedEmail)) {
      errors.push(`Additional email ${index + 1}: Duplicate additional email address is not allowed`);
      return;
    }

    seenEmails.add(normalizedEmail);

    const parsedType = parseContactCsvEmailType(rawLabel);
    rows.push({
      email_address: normalizedEmail,
      canonical_type: parsedType.canonicalType ?? null,
      custom_type: parsedType.customType ?? null,
      display_order: rows.length,
    });
  });

  return {
    rows,
    errors,
  };
}
