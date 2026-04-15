import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { parseCSV } from '@alga-psa/core';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const testState = vi.hoisted(() => ({
  tenant: 'test-tenant',
  userId: 'test-user',
  createTenantKnexMock: vi.fn(),
  withTransactionMock: vi.fn(),
  createTagMock: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEventMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action({ user_id: testState.userId, tenant: testState.tenant }, { tenant: testState.tenant }, ...args),
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: testState.createTenantKnexMock,
    withTransaction: testState.withTransactionMock,
  };
});

vi.mock('@alga-psa/tags/actions', () => ({
  createTag: testState.createTagMock,
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: testState.publishWorkflowEventMock,
}));

import {
  exportContactsToCSV,
  generateContactCSVTemplate,
  importContactsFromCSV,
} from '../../../../packages/clients/src/actions/contact-actions/contactActions';

async function createTenant(db: Knex, tenantId: string) {
  await db('tenants').insert({
    tenant: tenantId,
    client_name: `Contact CSV Tenant ${tenantId.slice(0, 6)}`,
    email: `${tenantId.slice(0, 6)}@example.com`,
  });
}

async function createClient(db: Knex, tenantId: string, clientId: string) {
  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Client ${clientId.slice(0, 6)}`,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

const contactsImportDialogSource = readFileSync(
  new URL('../../../../packages/clients/src/components/contacts/ContactsImportDialog.tsx', import.meta.url),
  'utf8'
);

describe('contact CSV hybrid email import/export integration', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    testState.createTenantKnexMock.mockImplementation(async () => ({
      knex: db,
      tenant: testState.tenant,
    }));
    testState.withTransactionMock.mockImplementation(async (knexLike: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      knexLike.transaction((trx) => callback(trx))
    );
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('imports one phone column as the default work phone row', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    testState.tenant = tenantId;

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    const results = await importContactsFromCSV([
      {
        full_name: 'CSV Import Contact',
        email: `csv-import-${tenantId}@acme.com`,
        phone_number: '(555) 444-3333',
        client_id: clientId,
      } as any,
    ], false);

    expect(results).toHaveLength(1);
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.contact?.default_phone_number).toBe('(555) 444-3333');
    expect(results[0]?.contact?.phone_numbers).toHaveLength(1);
    expect(results[0]?.contact?.phone_numbers[0]).toMatchObject({
      phone_number: '(555) 444-3333',
      canonical_type: 'work',
      is_default: true,
      display_order: 0,
    });

    const storedPhoneRows = await db('contact_phone_numbers')
      .where({
        tenant: tenantId,
        contact_name_id: results[0]!.contact!.contact_name_id,
      })
      .orderBy('display_order', 'asc');

    expect(storedPhoneRows).toHaveLength(1);
    expect(storedPhoneRows[0]).toMatchObject({
      phone_number: '(555) 444-3333',
      canonical_type: 'work',
      is_default: true,
      display_order: 0,
    });
  });

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

    expect(contactsImportDialogSource).toContain("primary_email_type: 'Primary Email Label'");
    expect(contactsImportDialogSource).toContain("additional_email_addresses: 'Additional Email Addresses'");
    expect(contactsImportDialogSource).toContain('primary_email_type (work/personal/billing/other or a custom label)');
    expect(contactsImportDialogSource).toContain('additional_email_addresses (use `label:email@example.com | label:email@example.com`)');
    expect(contactsImportDialogSource).toContain('CSV import/export keeps `email` as the primary/default contact email.');
  });

  it('T029: CSV import creates and updates a contact with primary and additional email rows', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    testState.tenant = tenantId;

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    const createResults = await importContactsFromCSV([
      {
        full_name: 'Hybrid CSV Contact',
        email: `owner-${tenantId}@acme.com`,
        primary_email_canonical_type: 'work',
        additional_email_addresses: [
          {
            email_address: `billing-${tenantId}@acme.com`,
            canonical_type: 'billing',
            custom_type: null,
            display_order: 0,
          },
          {
            email_address: `alerts-${tenantId}@acme.com`,
            canonical_type: null,
            custom_type: 'Escalations',
            display_order: 1,
          },
        ],
        phone_number: '(555) 444-3333',
        client_id: clientId,
      } as any,
    ], false);

    expect(createResults).toHaveLength(1);
    expect(createResults[0]?.success).toBe(true);
    expect(createResults[0]?.contact).toMatchObject({
      email: `owner-${tenantId}@acme.com`,
      primary_email_canonical_type: 'work',
    });
    expect(createResults[0]?.contact?.additional_email_addresses).toEqual([
      expect.objectContaining({
        email_address: `billing-${tenantId}@acme.com`,
        canonical_type: 'billing',
        custom_type: null,
        display_order: 0,
      }),
      expect.objectContaining({
        email_address: `alerts-${tenantId}@acme.com`,
        canonical_type: null,
        custom_type: 'Escalations',
        display_order: 1,
      }),
    ]);

    const updateResults = await importContactsFromCSV([
      {
        full_name: 'Hybrid CSV Contact',
        email: `billing-${tenantId}@acme.com`,
        primary_email_canonical_type: 'billing',
        additional_email_addresses: [
          {
            email_address: `owner-${tenantId}@acme.com`,
            canonical_type: 'work',
            custom_type: null,
            display_order: 0,
          },
          {
            email_address: `alerts-${tenantId}@acme.com`,
            canonical_type: null,
            custom_type: 'Escalations',
            display_order: 1,
          },
          {
            email_address: `personal-${tenantId}@acme.com`,
            canonical_type: 'personal',
            custom_type: null,
            display_order: 2,
          },
        ],
        client_id: clientId,
        role: 'Billing Owner',
      } as any,
    ], true);

    expect(updateResults).toHaveLength(1);
    expect(updateResults[0]?.success).toBe(true);
    expect(updateResults[0]?.contact).toMatchObject({
      email: `billing-${tenantId}@acme.com`,
      primary_email_canonical_type: 'billing',
      role: 'Billing Owner',
    });
    expect(updateResults[0]?.contact?.additional_email_addresses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        email_address: `owner-${tenantId}@acme.com`,
        canonical_type: 'work',
        custom_type: null,
      }),
      expect.objectContaining({
        email_address: `alerts-${tenantId}@acme.com`,
        canonical_type: null,
        custom_type: 'Escalations',
      }),
      expect.objectContaining({
        email_address: `personal-${tenantId}@acme.com`,
        canonical_type: 'personal',
        custom_type: null,
      }),
    ]));
    expect(updateResults[0]?.contact?.additional_email_addresses).toHaveLength(3);

    const storedContact = await db('contacts')
      .where({ tenant: tenantId, contact_name_id: updateResults[0]!.contact!.contact_name_id })
      .first();
    expect(storedContact?.email).toBe(`billing-${tenantId}@acme.com`);

    const storedAdditionalRows = await db('contact_additional_email_addresses')
      .where({ tenant: tenantId, contact_name_id: updateResults[0]!.contact!.contact_name_id })
      .orderBy('display_order', 'asc');

    expect(storedAdditionalRows.map((row) => row.email_address)).toEqual([
      `alerts-${tenantId}@acme.com`,
      `personal-${tenantId}@acme.com`,
      `owner-${tenantId}@acme.com`,
    ]);
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
