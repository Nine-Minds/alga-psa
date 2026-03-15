import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const contactsSource = readFileSync(
  new URL('../../../../../packages/clients/src/components/contacts/Contacts.tsx', import.meta.url),
  'utf8'
);

const clientDetailsSource = readFileSync(
  new URL('../../../../../packages/clients/src/components/clients/ClientDetails.tsx', import.meta.url),
  'utf8'
);

const contactPickerSource = readFileSync(
  new URL('../../../../../packages/ui/src/components/ContactPicker.tsx', import.meta.url),
  'utf8'
);

const contactPickerDialogSource = readFileSync(
  new URL('../../../../../packages/ui/src/components/ContactPickerDialog.tsx', import.meta.url),
  'utf8'
);

describe('Contact summary email compatibility', () => {
  it('T024: contacts and client-contact summary surfaces continue using contact.email as the visible email field', () => {
    expect(contactsSource).toContain("title: 'Email'");
    expect(contactsSource).toContain("render: (value, record): React.ReactNode => record.email || 'N/A'");
    expect(contactsSource).toContain("(contact.email && contact.email.toLowerCase().includes(searchTermLower))");
    expect(clientDetailsSource).toContain('{contact.email && ` (${contact.email})`}');
  });

  it('T025: ContactPicker and related picker dialogs keep filtering and rendering the primary contact.email summary field', () => {
    expect(contactPickerSource).toContain("(contact.email ?? '').toLowerCase().includes(lowerSearchTerm)");
    expect(contactPickerSource).toContain('{contact.email}</div>');
    expect(contactPickerDialogSource).toContain("(contact.email?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false)");
  });
});
