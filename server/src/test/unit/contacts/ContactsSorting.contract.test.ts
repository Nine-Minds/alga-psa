import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const contactsListSource = readFileSync(
  new URL('../../../../../packages/clients/src/components/contacts/Contacts.tsx', import.meta.url),
  'utf8'
);

const contactQueryActionsSource = readFileSync(
  new URL('../../../../../packages/clients/src/actions/queryActions.ts', import.meta.url),
  'utf8'
);

describe('Contacts sorting contracts', () => {
  it('uses client_name as the contacts table sort key for the client column', () => {
    expect(contactsListSource).toContain("title: 'Client'");
    expect(contactsListSource).toContain("dataIndex: 'client_name'");
    expect(contactQueryActionsSource).toContain("client_name: 'clients.client_name'");
    expect(contactQueryActionsSource).toContain("['full_name', 'created_at', 'email', 'client_name', 'phone_number']");
    expect(contactQueryActionsSource).toContain("const dbSortBy = safeSortBy === 'client_name'");
    expect(contactQueryActionsSource).toContain("? 'full_name'");
  });

  it('disables sorting for non-data contacts table columns', () => {
    expect(contactsListSource).toContain("title: 'Phone Number'");
    expect(contactsListSource).toContain("dataIndex: 'default_phone_number'");
    expect(contactsListSource).toContain('sortable: false');
    expect(contactsListSource).toContain("title: 'Tags'");
    expect(contactsListSource).toContain("dataIndex: 'tags'");
    expect(contactsListSource).toContain("title: 'Actions'");
    expect(contactsListSource).toContain("dataIndex: 'actions'");
  });
});
