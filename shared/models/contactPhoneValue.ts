/**
 * Pure per-value phone checks shared by ContactModel and integrations that need
 * to pre-validate a phone string without a database round trip.
 */

export const phonePattern = /^[0-9A-Za-z+().\-#\s/]+$/;

export function normalizePhoneForSearch(phoneNumber: string): string {
  return phoneNumber.replace(/\D/g, '');
}

export type ContactPhoneNumberValueCheck =
  | { valid: true; phoneNumber: string }
  | {
      valid: false;
      reason: 'no_digits' | 'unsupported_characters';
      message: string;
    };

/** Same checks, same messages, as ContactModel.validatePhoneNumbers applies to one phone_number. */
export function checkContactPhoneNumberValue(phoneNumber: string): ContactPhoneNumberValueCheck {
  const trimmedPhoneNumber = phoneNumber.trim();
  if (!normalizePhoneForSearch(trimmedPhoneNumber)) {
    return { valid: false, reason: 'no_digits', message: 'Phone number must contain at least one digit' };
  }
  if (!phonePattern.test(trimmedPhoneNumber)) {
    return {
      valid: false,
      reason: 'unsupported_characters',
      message: 'Phone number contains unsupported characters',
    };
  }
  return { valid: true, phoneNumber: trimmedPhoneNumber };
}
