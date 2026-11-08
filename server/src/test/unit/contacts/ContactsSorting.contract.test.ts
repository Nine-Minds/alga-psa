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
    expect(contactsListSource).toContain("title: t('contactsPage.table.client', { defaultValue: 'Client' })");
    expect(contactsListSource).toContain("dataIndex: 'client_name'");
    expect(contactQueryActionsSource).toContain("client_name: 'clients.client_name'");
    expect(contactQueryActionsSource).toContain("['full_name', 'created_at', 'email', 'client_name', 'phone_number', 'primaryLocation']");
    expect(contactQueryActionsSource).toContain("const dbSortBy = safeSortBy === 'client_name'");
    expect(contactQueryActionsSource).toContain("? 'full_name'");
  });

  // The Location column is sortable, and its value is not a column of `contacts`: the order is
  // applied in TypeScript once the links have been attached.
  it('sorts the location column by the primary location name', () => {
    expect(contactsListSource).toContain("title: t('contactsPage.table.location', { defaultValue: 'Location' })");
    expect(contactsListSource).toContain("dataIndex: 'primaryLocation'");
    expect(contactQueryActionsSource).toContain('primaryLocation: contactLocationSortKey');
    expect(contactQueryActionsSource).toContain("safeSortBy === 'primaryLocation' ? sortContacts(withLocations");
  });

  it('disables sorting for non-data contacts table columns', () => {
    expect(contactsListSource).toContain("title: t('contactsPage.table.phoneNumber', { defaultValue: 'Phone Number' })");
    expect(contactsListSource).toContain("dataIndex: 'default_phone_number'");
    expect(contactsListSource).toContain('sortable: false');
    expect(contactsListSource).toContain("title: t('contactsPage.table.tags', { defaultValue: 'Tags' })");
    expect(contactsListSource).toContain("dataIndex: 'tags'");
    expect(contactsListSource).toContain("title: t('contactsPage.table.actions', { defaultValue: 'Actions' })");
    expect(contactsListSource).toContain("dataIndex: 'actions'");
  });
});
