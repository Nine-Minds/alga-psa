import { describe, expect, it } from 'vitest';

import { ContactModel } from '../contactModel';
import {
  checkContactPhoneNumberValue,
  normalizePhoneForSearch,
  phonePattern,
} from '../contactPhoneValue';

function validatePhone(phoneNumber: string) {
  return ContactModel.validatePhoneNumbers([
    { phone_number: phoneNumber, canonical_type: 'work', is_default: true, display_order: 0 },
  ]);
}

describe('checkContactPhoneNumberValue', () => {
  it('T003: returns the messages validatePhoneNumbers produced before the move', () => {
    expect(checkContactPhoneNumberValue('abc')).toEqual({
      valid: false,
      reason: 'no_digits',
      message: 'Phone number must contain at least one digit',
    });
    expect(checkContactPhoneNumberValue('+1;2')).toEqual({
      valid: false,
      reason: 'unsupported_characters',
      message: 'Phone number contains unsupported characters',
    });
    expect(checkContactPhoneNumberValue('  +1 (416) 555-1234 ')).toEqual({
      valid: true,
      phoneNumber: '+1 (416) 555-1234',
    });
  });

  it('keeps the original pattern and digit normalisation', () => {
    expect(phonePattern.source).toBe('^[0-9A-Za-z+().\\-#\\s/]+$');
    expect(normalizePhoneForSearch('+1 (416) 555-1234')).toBe('14165551234');
  });

  it('T003: ContactModel.validatePhoneNumbers reports identical errors and still rejects ;ext=', () => {
    expect(validatePhone('+14165551234;ext=228')).toEqual({
      valid: false,
      errors: ['phone_numbers.0.phone_number: Phone number contains unsupported characters'],
    });
    expect(validatePhone('abc')).toEqual({
      valid: false,
      errors: ['phone_numbers.0.phone_number: Phone number must contain at least one digit'],
    });
    expect(validatePhone('+1 (416) 555-1234').valid).toBe(true);
  });
});
