import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const contactDetailsSource = readFileSync(
  new URL('../../../../../packages/clients/src/components/contacts/ContactDetailsEdit.tsx', import.meta.url),
  'utf8'
);

describe('ContactDetailsEdit normalized phone save contract', () => {
  it('T016: ContactDetailsEdit.tsx edits phone_numbers through the shared editor and saves the normalized collection', () => {
    expect(contactDetailsSource).toContain('ContactPhoneNumbersEditor');
    expect(contactDetailsSource).toContain("value={contact.phone_numbers}");
    expect(contactDetailsSource).toContain("onChange={(rows) => handleInputChange('phone_numbers', rows)}");
    expect(contactDetailsSource).toContain('phone_numbers: compactContactPhoneNumbers(contact.phone_numbers),');
    expect(contactDetailsSource).toContain('const updatedContact = await updateContact({');
    expect(contactDetailsSource).not.toMatch(/\bcontact\.phone_number\b/);
  });

  it('T017: ContactDetailsEdit.tsx blocks save when validateContactPhoneNumbers reports invalid default selection or type state', () => {
    // The stored rows are passed so an unchanged legacy number is grandfathered
    // rather than blocking every other edit to the contact, and `t` so the message
    // it blocks with is in the user's language.
    expect(contactDetailsSource).toContain('const currentPhoneErrors = validateContactPhoneNumbers(contact.phone_numbers, { existingRows: initialContact.phone_numbers, t });');
    expect(contactDetailsSource).toContain('setPhoneValidationErrors(currentPhoneErrors);');
    expect(contactDetailsSource).toContain('if (currentPhoneErrors.length > 0) {');
    expect(contactDetailsSource).toContain('setError(currentPhoneErrors[0]);');
    expect(contactDetailsSource).toContain('return;');
  });
});
