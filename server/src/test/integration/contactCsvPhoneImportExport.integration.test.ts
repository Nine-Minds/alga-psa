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

describe('contact CSV normalized phone import/export integration', () => {
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

  it('T027: importing one phone column creates one default normalized contact phone row', async () => {
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

  it('T028: exporting contacts emits the derived default phone number instead of a legacy scalar phone field', async () => {
    const csv = await exportContactsToCSV(
      [
        {
          contact_name_id: 'contact-1',
          full_name: 'CSV Export Contact',
          email: 'csv-export@acme.com',
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
    expect(rows[0]).toEqual(['full_name', 'email', 'phone_number', 'client', 'role', 'notes', 'tags']);
    expect(rows[1]).toEqual([
      'CSV Export Contact',
      'csv-export@acme.com',
      '555-1111',
      'Acme Client',
      'Coordinator',
      'Export test',
      '',
    ]);
  });

  it('T029: ContactsImportDialog copy explains the single default-phone CSV rule', () => {
    expect(contactsImportDialogSource).toContain("phone_number: 'Default Phone Number'");
    expect(contactsImportDialogSource).toContain('phone_number (imports as the default work phone)');
    expect(contactsImportDialogSource).toContain('CSV import/export in v1 handles one default phone number per contact.');
  });
});
