import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const contactsSource = readFileSync(
  new URL('../../../../../packages/clients/src/components/contacts/Contacts.tsx', import.meta.url),
  'utf8'
);

describe('Contacts additional-email search wiring', () => {
  it('includes additional email rows in the local contact search matcher', () => {
    expect(contactsSource).toContain('contact.additional_email_addresses?.some((emailAddress) =>');
    expect(contactsSource).toContain('emailAddress.email_address.toLowerCase().includes(searchTermLower)');
  });
});
