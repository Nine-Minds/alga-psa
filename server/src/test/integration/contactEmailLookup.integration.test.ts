import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { ContactModel } from '../../../../shared/models/contactModel';

const testState = vi.hoisted(() => ({
  tenant: 'test-tenant',
  userId: 'test-user',
  createTenantKnexMock: vi.fn(),
  withTransactionMock: vi.fn(),
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

import {
  createOrFindContactByEmail,
  findContactByEmailAddress,
} from '../../../../packages/clients/src/actions/queryActions';

async function createTenant(db: Knex, tenantId: string) {
  await db('tenants').insert({
    tenant: tenantId,
    client_name: `Lookup Tenant ${tenantId.slice(0, 6)}`,
    email: `${tenantId.slice(0, 6)}@example.com`,
  });
}

async function createClient(db: Knex, tenantId: string, clientId: string, clientName: string) {
  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: clientName,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

describe('contact email lookup integration', () => {
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

  it('T031: findContactByEmailAddress returns a contact when only an additional email matches', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    testState.tenant = tenantId;

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId, 'Lookup Client');

    const createdContact = await db.transaction((trx) =>
      ContactModel.createContact({
        full_name: 'Lookup Contact',
        email: `owner-${tenantId}@acme.com`,
        client_id: clientId,
        primary_email_canonical_type: 'work',
        additional_email_addresses: [
          {
            email_address: `billing-${tenantId}@acme.com`,
            canonical_type: 'billing',
            custom_type: null,
            display_order: 0,
          },
        ],
        phone_numbers: [],
      }, tenantId, trx)
    );

    const foundContact = await findContactByEmailAddress(`billing-${tenantId}@acme.com`);

    expect(foundContact).toMatchObject({
      contact_name_id: createdContact.contact_name_id,
      email: `owner-${tenantId}@acme.com`,
    });
    expect(foundContact?.additional_email_addresses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        email_address: `billing-${tenantId}@acme.com`,
        canonical_type: 'billing',
      }),
    ]));
  });

  it('T032: createOrFindContactByEmail creates a new contact with the email stored on contacts.email and no child rows when no match exists', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    testState.tenant = tenantId;

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId, 'Created Contact Client');

    const result = await createOrFindContactByEmail({
      email: `new-contact-${tenantId}@acme.com`,
      name: 'Created From Lookup',
      clientId,
      phone: '555-1234',
      title: 'Coordinator',
    });

    expect(result.isNew).toBe(true);
    expect(result.contact).toMatchObject({
      email: `new-contact-${tenantId}@acme.com`,
      full_name: 'Created From Lookup',
      client_id: clientId,
      client_name: 'Created Contact Client',
      role: 'Coordinator',
    });
    expect(result.contact.additional_email_addresses).toEqual([]);

    const storedContact = await db('contacts')
      .where({ tenant: tenantId, contact_name_id: result.contact.contact_name_id })
      .first();
    expect(storedContact?.email).toBe(`new-contact-${tenantId}@acme.com`);

    const storedAdditionalEmailRows = await db('contact_additional_email_addresses')
      .where({ tenant: tenantId, contact_name_id: result.contact.contact_name_id });
    expect(storedAdditionalEmailRows).toEqual([]);
  });

  it('createOrFindContactByEmail returns the existing contact when only an additional email matches', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    testState.tenant = tenantId;

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId, 'Existing Lookup Client');

    const existingContact = await db.transaction((trx) =>
      ContactModel.createContact({
        full_name: 'Existing Lookup Contact',
        email: `owner-${tenantId}@acme.com`,
        client_id: clientId,
        primary_email_canonical_type: 'work',
        additional_email_addresses: [
          {
            email_address: `afterhours-${tenantId}@acme.com`,
            canonical_type: null,
            custom_type: 'After Hours',
            display_order: 0,
          },
        ],
        phone_numbers: [],
      }, tenantId, trx)
    );

    const result = await createOrFindContactByEmail({
      email: `afterhours-${tenantId}@acme.com`,
      clientId,
      name: 'Should Not Replace Existing',
    });

    expect(result.isNew).toBe(false);
    expect(result.contact.contact_name_id).toBe(existingContact.contact_name_id);
    expect(result.contact.email).toBe(`owner-${tenantId}@acme.com`);
    expect(result.contact.additional_email_addresses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        email_address: `afterhours-${tenantId}@acme.com`,
        custom_type: 'After Hours',
      }),
    ]));
  });

  it('T049: create, swap, lookup by both addresses, and uniqueness guards hold after promoting an additional email', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    testState.tenant = tenantId;

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId, 'Swap Lookup Client');

    const originalPrimaryEmail = `owner-${tenantId}@acme.com`;
    const promotedEmail = `billing-${tenantId}@acme.com`;

    const createdContact = await db.transaction((trx) =>
      ContactModel.createContact({
        full_name: 'Swap Lookup Contact',
        email: originalPrimaryEmail,
        client_id: clientId,
        primary_email_canonical_type: 'work',
        additional_email_addresses: [
          {
            email_address: promotedEmail,
            canonical_type: 'billing',
            display_order: 0,
          },
        ],
        phone_numbers: [],
      }, tenantId, trx)
    );

    await db.transaction((trx) =>
      ContactModel.updateContact(createdContact.contact_name_id, {
        email: promotedEmail,
        additional_email_addresses: [
          {
            email_address: promotedEmail,
            canonical_type: 'billing',
            display_order: 0,
          },
        ],
      }, tenantId, trx)
    );

    const promotedLookup = await findContactByEmailAddress(promotedEmail);
    const demotedLookup = await findContactByEmailAddress(originalPrimaryEmail);

    expect(promotedLookup).toMatchObject({
      contact_name_id: createdContact.contact_name_id,
      email: promotedEmail,
    });
    expect(demotedLookup).toMatchObject({
      contact_name_id: createdContact.contact_name_id,
      email: promotedEmail,
    });
    expect(demotedLookup?.additional_email_addresses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        email_address: originalPrimaryEmail,
        canonical_type: 'work',
      }),
    ]));

    await expect(
      db.transaction((trx) =>
        ContactModel.createContact({
          full_name: 'Duplicate Demoted Email',
          email: originalPrimaryEmail,
          client_id: clientId,
          phone_numbers: [],
        }, tenantId, trx)
      )
    ).rejects.toThrow();

    await expect(
      db.transaction((trx) =>
        ContactModel.createContact({
          full_name: 'Duplicate Promoted Email',
          email: `secondary-${tenantId}@acme.com`,
          client_id: clientId,
          additional_email_addresses: [
            {
              email_address: promotedEmail,
              canonical_type: 'billing',
              display_order: 0,
            },
          ],
          phone_numbers: [],
        }, tenantId, trx)
      )
    ).rejects.toThrow();
  });
});
