import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const contactDetailsEditSource = readFileSync(
  new URL('../../../../../packages/clients/src/components/contacts/ContactDetailsEdit.tsx', import.meta.url),
  'utf8'
);

const contactDetailsViewSource = readFileSync(
  new URL('../../../../../packages/clients/src/components/contacts/ContactDetailsView.tsx', import.meta.url),
  'utf8'
);

describe('Contact details normalized phone wiring', () => {
  it('T018: ContactDetailsEdit renders existing multiple phone rows through the shared phone editor and preserves custom type labels from contact.phone_numbers', () => {
    expect(contactDetailsEditSource).toContain('ContactPhoneNumbersEditor');
    expect(contactDetailsEditSource).toContain("value={contact.phone_numbers}");
    expect(contactDetailsEditSource).toContain("onChange={(rows) => handleInputChange('phone_numbers', rows)}");
    expect(contactDetailsEditSource).toContain('listContactPhoneTypeSuggestions()');
  });

  it('T019: ContactDetailsView shows the derived default phone from phone_numbers instead of relying on a scalar phone_number field', () => {
    expect(contactDetailsViewSource).toContain('contact.phone_numbers.map((phone) => (');
    expect(contactDetailsViewSource).toContain("{phone.is_default ? ' • Default' : ''}");
    expect(contactDetailsViewSource).not.toMatch(/\bcontact\.phone_number\b/);
  });
});
