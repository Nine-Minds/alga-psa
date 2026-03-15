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

describe('Contact details email address wiring', () => {
  it('T020: ContactDetailsEdit saves the hybrid email payload through the shared email editor and normalized contact update action', () => {
    expect(contactDetailsEditSource).toContain('ContactEmailAddressesEditor');
    expect(contactDetailsEditSource).toContain('const currentEmailErrors = validateContactEmailAddresses(contact);');
    expect(contactDetailsEditSource).toContain('const compactedEmails = compactContactEmailAddresses(contact);');
    expect(contactDetailsEditSource).toContain('...compactedEmails,');
    expect(contactDetailsEditSource).toContain("onChange={(value) => setContact((previousContact) => ({ ...previousContact, ...value }))}");
  });

  it('T021: ContactDetailsView renders the primary email distinctly and lists additional email addresses with labels', () => {
    expect(contactDetailsViewSource).toContain('contact.primary_email_canonical_type');
    expect(contactDetailsViewSource).toContain("{' • Default'}");
    expect(contactDetailsViewSource).toContain('contact.additional_email_addresses.map((emailAddress) => (');
    expect(contactDetailsViewSource).toContain('emailAddress.email_address');
    expect(contactDetailsViewSource).toContain('getEmailTypeLabel(emailAddress)');
  });
});
