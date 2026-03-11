import type { ContactPhoneNumberInput } from '@alga-psa/types';
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

export function buildEntraContactPhoneNumbers(user: EntraSyncUser): ContactPhoneNumberInput[] {
  const businessPhones = user.businessPhones
    .map((value) => value.trim())
    .filter(Boolean);
  const mobilePhone = user.mobilePhone?.trim() || '';

  const phoneNumbers: ContactPhoneNumberInput[] = [];

  businessPhones.forEach((phoneNumber, index) => {
    phoneNumbers.push({
      phone_number: phoneNumber,
      canonical_type: 'work',
      is_default: index === 0,
      display_order: phoneNumbers.length,
    });
  });

  if (mobilePhone) {
    phoneNumbers.push({
      phone_number: mobilePhone,
      canonical_type: 'mobile',
      is_default: businessPhones.length === 0,
      display_order: phoneNumbers.length,
    });
  }

  return phoneNumbers;
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
