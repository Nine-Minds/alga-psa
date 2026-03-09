import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const contactDetailsSource = readFileSync(
  new URL('../../../../../packages/clients/src/components/contacts/ContactDetails.tsx', import.meta.url),
  'utf8'
);

describe('ContactDetails normalized phone save contract', () => {
  it('T016: ContactDetails.tsx edits phone_numbers through the shared editor and saves the normalized collection', () => {
    expect(contactDetailsSource).toContain('ContactPhoneNumbersEditor');
    expect(contactDetailsSource).toContain("value={editedContact.phone_numbers}");
    expect(contactDetailsSource).toContain("onChange={(rows) => handleFieldChange('phone_numbers', rows)}");
    expect(contactDetailsSource).toContain('const updatedContact = await updateContact(dataToUpdate);');
    expect(contactDetailsSource).not.toMatch(/\beditedContact\.phone_number\b/);
  });

  it('T017: ContactDetails.tsx blocks save when validateContactPhoneNumbers reports invalid default selection or type state', () => {
    expect(contactDetailsSource).toContain('const currentPhoneErrors = validateContactPhoneNumbers(editedContact.phone_numbers);');
    expect(contactDetailsSource).toContain('setPhoneValidationErrors(currentPhoneErrors);');
    expect(contactDetailsSource).toContain('if (currentPhoneErrors.length > 0) {');
    expect(contactDetailsSource).toContain("description: currentPhoneErrors[0]");
    expect(contactDetailsSource).toContain('return;');
  });
});
