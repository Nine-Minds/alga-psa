import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { parseCSV } from '@alga-psa/core';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action({ user_id: 'test-user', tenant: 'test-tenant' }, { tenant: 'test-tenant' }, ...args),
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(),
    withTransaction: vi.fn(),
  };
});

vi.mock('@alga-psa/tags/actions', () => ({
  createTag: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

import {
  exportContactsToCSV,
  generateContactCSVTemplate,
} from '../../../../../packages/clients/src/actions/contact-actions/contactActions';

const contactsImportDialogSource = readFileSync(
  new URL('../../../../../packages/clients/src/components/contacts/ContactsImportDialog.tsx', import.meta.url),
  'utf8'
);

describe('contact CSV hybrid email contract', () => {
  it('T028: contact CSV template and dialog copy describe primary and additional email fields', async () => {
    const csvTemplate = await generateContactCSVTemplate();
    const rows = parseCSV(csvTemplate) as string[][];

    expect(rows[0]).toEqual([
      'full_name',
      'email',
      'primary_email_type',
      'additional_email_addresses',
      'phone_number',
      'client',
      'role',
      'notes',
      'tags',
    ]);
    expect(rows[1]?.[2]).toBe('work');
    expect(rows[1]?.[3]).toContain('personal:alice.home@wonderland.com');
    expect(rows[1]?.[3]).toContain('billing:accounts@wonderland.com');

    expect(contactsImportDialogSource).toContain("phone_number: 'Default Phone Number'");
    expect(contactsImportDialogSource).toContain("primary_email_type: 'Primary Email Label'");
    expect(contactsImportDialogSource).toContain("additional_email_addresses: 'Additional Email Addresses'");
    expect(contactsImportDialogSource).toContain('primary_email_type (work/personal/billing/other or a custom label)');
    expect(contactsImportDialogSource).toContain('additional_email_addresses (use `label:email@example.com | label:email@example.com`)');
    expect(contactsImportDialogSource).toContain('phone_number (imports as the default work phone)');
    expect(contactsImportDialogSource).toContain('CSV import/export keeps `email` as the primary/default contact email.');
  });

  it('T030: contact CSV export includes primary email labels and additional-email rows while keeping the derived default phone', async () => {
    const csv = await exportContactsToCSV(
      [
        {
          contact_name_id: 'contact-1',
          full_name: 'CSV Export Contact',
          email: 'csv-export@acme.com',
          primary_email_canonical_type: null,
          primary_email_type: 'Escalations',
          additional_email_addresses: [
            {
              contact_additional_email_address_id: 'email-1',
              email_address: 'billing@acme.com',
              normalized_email_address: 'billing@acme.com',
              canonical_type: 'billing',
              custom_type: null,
              display_order: 0,
            },
            {
              contact_additional_email_address_id: 'email-2',
              email_address: 'afterhours@acme.com',
              normalized_email_address: 'afterhours@acme.com',
              canonical_type: null,
              custom_type: 'After Hours',
              display_order: 1,
            },
          ],
          client_id: 'client-1',
          role: 'Coordinator',
          notes: 'Export test',
          default_phone_number: null,
          phone_numbers: [
            {
              contact_phone_number_id: 'phone-1',
              phone_number: '555-0000',
              normalized_phone_number: '5550000',
              canonical_type: 'work',
              custom_type: null,
              is_default: false,
              display_order: 0,
            },
            {
              contact_phone_number_id: 'phone-2',
              phone_number: '555-1111',
              normalized_phone_number: '5551111',
              canonical_type: 'mobile',
              custom_type: null,
              is_default: true,
              display_order: 1,
            },
          ],
        } as any,
      ],
      [
        {
          client_id: 'client-1',
          client_name: 'Acme Client',
        } as any,
      ],
      { 'contact-1': [] }
    );

    const rows = parseCSV(csv) as string[][];
    expect(rows[0]).toEqual([
      'full_name',
      'email',
      'primary_email_type',
      'additional_email_addresses',
      'phone_number',
      'client',
      'role',
      'notes',
      'tags',
    ]);
    expect(rows[1]).toEqual([
      'CSV Export Contact',
      'csv-export@acme.com',
      'Escalations',
      'billing: billing@acme.com | After Hours: afterhours@acme.com',
      '555-1111',
      'Acme Client',
      'Coordinator',
      'Export test',
      '',
    ]);
  });
});
