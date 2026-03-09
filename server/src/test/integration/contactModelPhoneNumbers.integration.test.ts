import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { ContactModel } from '@alga-psa/shared/models/contactModel';

async function createTenant(db: Knex, tenantId: string) {
  await db('tenants').insert({
    tenant: tenantId,
    client_name: `Contact Phone Tenant ${tenantId.slice(0, 6)}`,
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

describe('contact model phone numbers integration', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T011: reuses an existing tenant custom phone type definition when case/spacing differ on update', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    await db.transaction(async (trx) => {
      const created = await ContactModel.createContact({
        full_name: 'Custom Type Contact',
        email: `custom-${tenantId}@example.com`,
        client_id: clientId,
        phone_numbers: [{
          phone_number: '555-0100',
          custom_type: 'Desk Line',
          is_default: true,
          display_order: 0,
        }],
      }, tenantId, trx);

      const originalDefinition = await trx('contact_phone_type_definitions')
        .where({ tenant: tenantId, normalized_label: 'desk line' })
        .first<{ contact_phone_type_id: string }>();

      expect(originalDefinition?.contact_phone_type_id).toBeDefined();

      await ContactModel.updateContact(created.contact_name_id, {
        phone_numbers: [{
          phone_number: '555-0101',
          custom_type: '  desk   line  ',
          is_default: true,
          display_order: 0,
        }],
      }, tenantId, trx);

      const definitions = await trx('contact_phone_type_definitions')
        .where({ tenant: tenantId, normalized_label: 'desk line' })
        .select('contact_phone_type_id');

      const updatedPhoneRow = await trx('contact_phone_numbers')
        .where({ tenant: tenantId, contact_name_id: created.contact_name_id })
        .first<{ custom_phone_type_id: string }>();

      expect(definitions).toHaveLength(1);
      expect(updatedPhoneRow?.custom_phone_type_id).toBe(originalDefinition?.contact_phone_type_id);
    });
  });

  it('T012: creating a contact persists ordered child phone rows with the parent in one transaction', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    await db.transaction(async (trx) => {
      const created = await ContactModel.createContact({
        full_name: 'Transactional Create Contact',
        email: `create-${tenantId}@example.com`,
        client_id: clientId,
        phone_numbers: [
          {
            phone_number: '555-0100',
            canonical_type: 'work',
            is_default: true,
            display_order: 0,
          },
          {
            phone_number: '555-0101',
            custom_type: 'Desk Line',
            is_default: false,
            display_order: 1,
          },
        ],
      }, tenantId, trx);

      const storedContact = await trx('contacts')
        .where({ tenant: tenantId, contact_name_id: created.contact_name_id })
        .first();
      const storedPhones = await trx('contact_phone_numbers')
        .where({ tenant: tenantId, contact_name_id: created.contact_name_id })
        .orderBy('display_order', 'asc');

      expect(storedContact).toBeTruthy();
      expect(storedPhones).toHaveLength(2);
      expect(storedPhones.map((row) => row.phone_number)).toEqual(['555-0100', '555-0101']);
      expect(storedPhones.map((row) => row.is_default)).toEqual([true, false]);
    });
  });

  it('T013: updating a contact replaces, reorders, and re-defaults child phone rows without duplicates', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    await db.transaction(async (trx) => {
      const created = await ContactModel.createContact({
        full_name: 'Reorder Contact',
        email: `update-${tenantId}@example.com`,
        client_id: clientId,
        phone_numbers: [
          {
            phone_number: '555-0100',
            canonical_type: 'work',
            is_default: true,
            display_order: 0,
          },
          {
            phone_number: '555-0101',
            canonical_type: 'mobile',
            is_default: false,
            display_order: 1,
          },
        ],
      }, tenantId, trx);

      const originalPhoneIds = created.phone_numbers.map((row) => row.contact_phone_number_id);

      await ContactModel.updateContact(created.contact_name_id, {
        phone_numbers: [
          {
            phone_number: '555-0101',
            canonical_type: 'mobile',
            is_default: true,
            display_order: 0,
          },
          {
            phone_number: '555-0102',
            canonical_type: 'fax',
            is_default: false,
            display_order: 1,
          },
        ],
      }, tenantId, trx);

      const updatedPhones = await trx('contact_phone_numbers')
        .where({ tenant: tenantId, contact_name_id: created.contact_name_id })
        .orderBy('display_order', 'asc');

      expect(updatedPhones).toHaveLength(2);
      expect(updatedPhones.map((row) => row.phone_number)).toEqual(['555-0101', '555-0102']);
      expect(updatedPhones.map((row) => row.is_default)).toEqual([true, false]);
      expect(updatedPhones.some((row) => originalPhoneIds.includes(row.contact_phone_number_id))).toBe(false);
    });
  });

  it('T014: a failed phone write rolls back both parent and child mutations', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    const duplicatePhoneRowId = uuidv4();
    await expect(db.transaction(async (trx) => {
      await ContactModel.createContact({
        full_name: 'Rollback Contact',
        email: `rollback-${tenantId}@example.com`,
        client_id: clientId,
        phone_numbers: [
          {
            contact_phone_number_id: duplicatePhoneRowId,
            phone_number: '555-0100',
            canonical_type: 'work',
            is_default: true,
            display_order: 0,
          },
          {
            contact_phone_number_id: duplicatePhoneRowId,
            phone_number: '555-0101',
            canonical_type: 'mobile',
            is_default: false,
            display_order: 1,
          },
        ],
      }, tenantId, trx);
    })).rejects.toThrow();

    const rolledBackContact = await db('contacts')
      .where({ tenant: tenantId, email: `rollback-${tenantId}@example.com` })
      .first();
    const rolledBackPhoneRows = await db('contact_phone_numbers')
      .where({ tenant: tenantId, contact_phone_number_id: duplicatePhoneRowId });

    expect(rolledBackContact).toBeUndefined();
    expect(rolledBackPhoneRows).toHaveLength(0);
  });

  it('T015: fetching a contact returns phone_numbers ordered by display_order with the correct default row', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    await db.transaction(async (trx) => {
      const created = await ContactModel.createContact({
        full_name: 'Read Contact',
        email: `read-${tenantId}@example.com`,
        client_id: clientId,
        phone_numbers: [
          {
            phone_number: '555-0100',
            canonical_type: 'work',
            is_default: false,
            display_order: 0,
          },
          {
            phone_number: '555-0101',
            custom_type: 'Desk Line',
            is_default: true,
            display_order: 1,
          },
        ],
      }, tenantId, trx);

      const loaded = await ContactModel.getContactById(created.contact_name_id, tenantId, trx);

      expect(loaded?.phone_numbers.map((row) => row.phone_number)).toEqual(['555-0100', '555-0101']);
      expect(loaded?.default_phone_number).toBe('555-0101');
      expect(loaded?.default_phone_type).toBe('Desk Line');
      expect(loaded?.phone_numbers.find((row) => row.is_default)?.phone_number).toBe('555-0101');
    });
  });
});
