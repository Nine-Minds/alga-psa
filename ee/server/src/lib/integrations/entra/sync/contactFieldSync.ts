import type { ContactPhoneNumberInput } from '@alga-psa/types';
import { checkContactPhoneNumberValue } from '@alga-psa/shared/models/contactPhoneValue';
import type { EntraSyncUser } from './types';

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isEnabled(config: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = config[key];
    if (value === true || value === 'true' || value === 1 || value === '1') {
      return true;
    }
  }
  return false;
}

function fallbackDisplayName(user: EntraSyncUser): string {
  if (user.displayName && user.displayName.trim()) {
    return user.displayName.trim();
  }

  const givenName = user.givenName?.trim() || '';
  const surname = user.surname?.trim() || '';
  const combined = `${givenName} ${surname}`.trim();
  if (combined) {
    return combined;
  }

  return (user.email || user.userPrincipalName || 'Entra Contact').split('@')[0];
}

export interface ParsedEntraPhoneValue {
  phoneNumber: string;
  extension?: string;
  /** Set only when an extension marker was found but the extension failed the row limits. */
  discardedExtension?: string;
}

export interface EntraPhoneFieldNotice {
  field: 'phone_numbers';
  source: 'businessPhones' | 'mobilePhone';
  rawValue: string;
  message: string;
}

// Extension markers recognised at the end of a Microsoft phone value (case-insensitive):
//   ;ext=228        unambiguous marker, captures everything after '='
//   <ws>ext 228     whitespace required before 'ext' / 'ext.'
//   <digit|ws|)>x228  'x' must follow a digit, whitespace or ')' so vanity numbers
//                     such as 1-800-BOX1234 are never split.
const ENTRA_PHONE_EXTENSION =
  /^(?<phone>.*?)(?:\s*;\s*ext\s*=\s*(?<semi>[^;]*)|\s+ext\.?\s*(?<word>[\d\s-]+)|(?<=[\d\s)])\s*x\s*(?<x>[\d\s-]+))\s*$/i;

const EXTENSION_PATTERN = /^\d{1,10}$/;

export function parseEntraPhoneValue(raw: string): ParsedEntraPhoneValue {
  const trimmed = raw.trim();
  const match = ENTRA_PHONE_EXTENSION.exec(trimmed);
  const phoneNumber = match?.groups?.phone?.trim() ?? '';
  if (!match || !phoneNumber) {
    return { phoneNumber: trimmed };
  }

  const captured = (match.groups?.semi ?? match.groups?.word ?? match.groups?.x ?? '').trim();
  const extension = captured.replace(/[\s-]/g, '');
  if (EXTENSION_PATTERN.test(extension)) {
    return { phoneNumber, extension };
  }
  return { phoneNumber, discardedExtension: captured };
}

export function buildEntraContactPhoneRows(user: EntraSyncUser): {
  rows: ContactPhoneNumberInput[];
  notices: EntraPhoneFieldNotice[];
} {
  const candidates: Array<{ source: EntraPhoneFieldNotice['source']; raw: string }> = [
    ...user.businessPhones.map((raw) => ({ source: 'businessPhones' as const, raw: raw.trim() })),
    { source: 'mobilePhone' as const, raw: user.mobilePhone?.trim() || '' },
  ].filter((candidate) => candidate.raw);

  const notices: EntraPhoneFieldNotice[] = [];
  const kept: Array<{ source: EntraPhoneFieldNotice['source']; phoneNumber: string; extension?: string }> = [];

  for (const { source, raw } of candidates) {
    const parsed = parseEntraPhoneValue(raw);
    if (parsed.discardedExtension !== undefined) {
      notices.push({
        field: 'phone_numbers',
        source,
        rawValue: raw,
        message: `Extension "${parsed.discardedExtension}" was dropped: extensions are 1-10 digits.`,
      });
    }

    const check = checkContactPhoneNumberValue(parsed.phoneNumber);
    if (check.valid === false) {
      notices.push({
        field: 'phone_numbers',
        source,
        rawValue: raw,
        message: `Phone number "${raw}" was not imported: ${check.message}.`,
      });
      continue;
    }
    kept.push({ source, phoneNumber: check.phoneNumber, extension: parsed.extension });
  }

  const defaultIndex = Math.max(
    kept.findIndex((entry) => entry.source === 'businessPhones'),
    0
  );
  const rows = kept.map((entry, index): ContactPhoneNumberInput => ({
    phone_number: entry.phoneNumber,
    ...(entry.extension ? { extension: entry.extension } : {}),
    canonical_type: entry.source === 'businessPhones' ? 'work' : 'mobile',
    is_default: index === defaultIndex,
    display_order: index,
  }));

  return { rows, notices };
}

export function buildEntraContactPhoneNumbers(user: EntraSyncUser): ContactPhoneNumberInput[] {
  return buildEntraContactPhoneRows(user).rows;
}

export function buildContactFieldSyncPatch(
  user: EntraSyncUser,
  fieldSyncConfig: unknown
): Record<string, unknown> {
  const config = toObject(fieldSyncConfig);
  const patch: Record<string, unknown> = {};

  if (isEnabled(config, ['displayName', 'display_name', 'fullName', 'full_name'])) {
    patch.full_name = fallbackDisplayName(user);
  }

  if (isEnabled(config, ['email', 'mail'])) {
    patch.email = user.email || user.userPrincipalName || null;
  }

  if (isEnabled(config, ['phone', 'phoneNumber', 'phone_number', 'mobilePhone', 'mobile_phone'])) {
    patch.phone_numbers = buildEntraContactPhoneNumbers(user);
  }

  if (isEnabled(config, ['role', 'jobTitle', 'job_title'])) {
    patch.role = user.jobTitle || null;
  }

  if (isEnabled(config, ['upn', 'userPrincipalName', 'user_principal_name'])) {
    patch.entra_user_principal_name = user.userPrincipalName || null;
  }

  return patch;
}
