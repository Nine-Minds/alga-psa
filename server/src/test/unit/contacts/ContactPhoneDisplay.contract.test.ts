import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const contactsListSource = readFileSync(
  new URL('../../../../../packages/clients/src/components/contacts/Contacts.tsx', import.meta.url),
  'utf8'
);

const clientContactsListSource = readFileSync(
  new URL('../../../../../packages/clients/src/components/contacts/ClientContactsList.tsx', import.meta.url),
  'utf8'
);

const ticketPropertiesSource = readFileSync(
  new URL('../../../../../packages/tickets/src/components/ticket/TicketProperties.tsx', import.meta.url),
  'utf8'
);

describe('Contact phone display contracts', () => {
  it('T022: Contacts.tsx renders the derived default phone number from normalized contact phone rows', () => {
    expect(contactsListSource).toContain("dataIndex: 'default_phone_number'");
    expect(contactsListSource).toContain('record.default_phone_number');
    expect(contactsListSource).toContain('record.phone_numbers?.find((phoneNumber: any) => phoneNumber.is_default)?.phone_number');
    expect(contactsListSource).not.toMatch(/\brecord\.phone_number\b/);
  });

  it('T023: ClientContactsList.tsx renders the derived default phone number from normalized contact phone rows', () => {
    expect(clientContactsListSource).toContain("dataIndex: 'default_phone_number'");
    expect(clientContactsListSource).toContain('record.default_phone_number');
    expect(clientContactsListSource).toContain('record.phone_numbers?.find((phoneNumber: any) => phoneNumber.is_default)?.phone_number');
    expect(clientContactsListSource).not.toMatch(/\brecord\.phone_number\b/);
  });

  it('T026: TicketProperties.tsx shows the default contact phone from normalized contact phone rows before falling back to the client phone', () => {
    expect(ticketPropertiesSource).toContain('contactInfo?.default_phone_number');
    expect(ticketPropertiesSource).toContain('contactInfo?.phone_numbers?.find((phoneNumber: { is_default?: boolean; phone_number?: string }) => phoneNumber.is_default)?.phone_number');
    expect(ticketPropertiesSource).toContain("|| client?.phone_no");
    expect(ticketPropertiesSource).not.toMatch(/\bcontactInfo\.phone_number\b/);
  });
});
