import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { ContactModel } from '@alga-psa/shared/models/contactModel';

async function createTenant(db: Knex, tenantId: string) {
  await db('tenants').insert({
    tenant: tenantId,
    client_name: `Contact Email Tenant ${tenantId.slice(0, 6)}`,
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

describe('contact model email addresses integration', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T012: creates a contact with primary email metadata and hydrates additional email rows', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    await db.transaction(async (trx) => {
      const created = await ContactModel.createContact({
        full_name: 'Hybrid Email Contact',
        email: `primary-${tenantId}@example.com`,
        client_id: clientId,
        primary_email_canonical_type: 'personal',
        additional_email_addresses: [
          {
            email_address: `secondary-${tenantId}@example.com`,
            canonical_type: 'work',
            display_order: 0,
          },
          {
            email_address: `tertiary-${tenantId}@example.com`,
            custom_type: 'Billing Contact',
            display_order: 1,
          },
        ],
      }, tenantId, trx);

      expect(created.primary_email_canonical_type).toBe('personal');
      expect(created.primary_email_type).toBe('personal');

      expect(created.additional_email_addresses).toHaveLength(2);
      expect(created.additional_email_addresses[0].email_address).toBe(`secondary-${tenantId}@example.com`);
      expect(created.additional_email_addresses[0].canonical_type).toBe('work');
      expect(created.additional_email_addresses[1].email_address).toBe(`tertiary-${tenantId}@example.com`);
      expect(created.additional_email_addresses[1].custom_type).toBe('Billing Contact');

      const hydrated = await ContactModel.getContactById(created.contact_name_id, tenantId, trx);
      expect(hydrated?.email).toBe(`primary-${tenantId}@example.com`);
      expect(hydrated?.additional_email_addresses).toHaveLength(2);
    });
  });

  it('T013: swaps an additional email into the primary when promoted', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    await db.transaction(async (trx) => {
      const created = await ContactModel.createContact({
        full_name: 'Swap Email Contact',
        email: `primary-${tenantId}@example.com`,
        client_id: clientId,
        primary_email_canonical_type: 'billing',
        additional_email_addresses: [
          {
            email_address: `secondary-${tenantId}@example.com`,
            custom_type: 'Escalations',
            display_order: 0,
          },
          {
            email_address: `tertiary-${tenantId}@example.com`,
            canonical_type: 'other',
            display_order: 1,
          },
        ],
      }, tenantId, trx);

      const updated = await ContactModel.updateContact(created.contact_name_id, {
        email: `secondary-${tenantId}@example.com`,
        additional_email_addresses: [
          {
            email_address: `secondary-${tenantId}@example.com`,
            custom_type: 'Escalations',
            display_order: 0,
          },
          {
            email_address: `tertiary-${tenantId}@example.com`,
            canonical_type: 'other',
            display_order: 1,
          },
        ],
      }, tenantId, trx);

      expect(updated.email).toBe(`secondary-${tenantId}@example.com`);
      expect(updated.primary_email_canonical_type).toBeNull();
      expect(updated.primary_email_type).toBe('Escalations');
      expect(updated.primary_email_custom_type_id).toBeTruthy();
      expect(updated.additional_email_addresses).toHaveLength(2);
      expect(updated.additional_email_addresses.find((row) => row.email_address === `primary-${tenantId}@example.com`)).toBeDefined();
      expect(updated.additional_email_addresses.find((row) => row.email_address === `tertiary-${tenantId}@example.com`)).toBeDefined();
      expect(updated.additional_email_addresses.find((row) => row.email_address === `primary-${tenantId}@example.com`)?.canonical_type).toBe('billing');
    });
  });

  it('accepts the normalized post-swap payload shape emitted by the shared email editor', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    await db.transaction(async (trx) => {
      const created = await ContactModel.createContact({
        full_name: 'Normalized Swap Payload Contact',
        email: `primary-${tenantId}@example.com`,
        client_id: clientId,
        primary_email_canonical_type: 'billing',
        additional_email_addresses: [
          {
            email_address: `secondary-${tenantId}@example.com`,
            custom_type: 'Escalations',
            display_order: 0,
          },
          {
            email_address: `tertiary-${tenantId}@example.com`,
            canonical_type: 'other',
            display_order: 1,
          },
        ],
      }, tenantId, trx);

      const updated = await ContactModel.updateContact(created.contact_name_id, {
        email: `secondary-${tenantId}@example.com`,
        primary_email_canonical_type: null,
        primary_email_custom_type: 'Escalations',
        additional_email_addresses: [
          {
            email_address: `tertiary-${tenantId}@example.com`,
            canonical_type: 'other',
            display_order: 0,
          },
          {
            email_address: `primary-${tenantId}@example.com`,
            canonical_type: 'billing',
            display_order: 1,
          },
        ],
      }, tenantId, trx);

      expect(updated.email).toBe(`secondary-${tenantId}@example.com`);
      expect(updated.primary_email_canonical_type).toBeNull();
      expect(updated.primary_email_type).toBe('Escalations');
      expect(updated.additional_email_addresses).toHaveLength(2);
      expect(updated.additional_email_addresses.find((row) => row.email_address === `primary-${tenantId}@example.com`)?.canonical_type).toBe('billing');
      expect(updated.additional_email_addresses.find((row) => row.email_address === `tertiary-${tenantId}@example.com`)?.canonical_type).toBe('other');
    });
  });

  it('accepts a second normalized swap after a previous promotion', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    await db.transaction(async (trx) => {
      const created = await ContactModel.createContact({
        full_name: 'Second Normalized Swap Contact',
        email: `primary-${tenantId}@example.com`,
        client_id: clientId,
        primary_email_canonical_type: 'work',
        additional_email_addresses: [
          {
            email_address: `billing-${tenantId}@example.com`,
            canonical_type: 'billing',
            display_order: 0,
          },
          {
            email_address: `escalations-${tenantId}@example.com`,
            custom_type: 'Escalations',
            display_order: 1,
          },
        ],
      }, tenantId, trx);

      const firstSwap = await ContactModel.updateContact(created.contact_name_id, {
        email: `billing-${tenantId}@example.com`,
        primary_email_canonical_type: 'billing',
        additional_email_addresses: [
          {
            contact_additional_email_address_id: created.additional_email_addresses.find(
              (row) => row.email_address === `escalations-${tenantId}@example.com`
            )?.contact_additional_email_address_id,
            email_address: `escalations-${tenantId}@example.com`,
            custom_type: 'Escalations',
            display_order: 0,
          },
          {
            email_address: `primary-${tenantId}@example.com`,
            canonical_type: 'work',
            display_order: 1,
          },
        ],
      }, tenantId, trx);

      const persistedEscalationsRow = firstSwap.additional_email_addresses.find(
        (row) => row.email_address === `escalations-${tenantId}@example.com`
      );
      const persistedPrimaryRow = firstSwap.additional_email_addresses.find(
        (row) => row.email_address === `primary-${tenantId}@example.com`
      );

      const secondSwap = await ContactModel.updateContact(created.contact_name_id, {
        email: `escalations-${tenantId}@example.com`,
        primary_email_canonical_type: null,
        primary_email_custom_type: 'Escalations',
        additional_email_addresses: [
          {
            contact_additional_email_address_id: persistedPrimaryRow?.contact_additional_email_address_id,
            email_address: `primary-${tenantId}@example.com`,
            canonical_type: 'work',
            display_order: 0,
          },
          {
            email_address: `billing-${tenantId}@example.com`,
            canonical_type: 'billing',
            display_order: 1,
          },
        ],
      }, tenantId, trx);

      expect(persistedEscalationsRow).toBeDefined();
      expect(secondSwap.email).toBe(`escalations-${tenantId}@example.com`);
      expect(secondSwap.primary_email_canonical_type).toBeNull();
      expect(secondSwap.primary_email_type).toBe('Escalations');
      expect(secondSwap.additional_email_addresses).toHaveLength(2);
      expect(secondSwap.additional_email_addresses.find((row) => row.email_address === `primary-${tenantId}@example.com`)?.canonical_type).toBe('work');
      expect(secondSwap.additional_email_addresses.find((row) => row.email_address === `billing-${tenantId}@example.com`)?.canonical_type).toBe('billing');
    });
  });

  it('T014: rejects removing the primary email directly', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    await db.transaction(async (trx) => {
      const created = await ContactModel.createContact({
        full_name: 'Primary Delete Guard Contact',
        email: `primary-${tenantId}@example.com`,
        client_id: clientId,
      }, tenantId, trx);

      await expect(ContactModel.updateContact(created.contact_name_id, {
        email: null,
      }, tenantId, trx)).rejects.toThrow('Primary email cannot be removed');
    });
  });

  it('T015: creates and reuses tenant-scoped custom email labels case-insensitively', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    await db.transaction(async (trx) => {
      await ContactModel.createContact({
        full_name: 'Custom Label Contact One',
        email: `contact-one-${tenantId}@example.com`,
        client_id: clientId,
        primary_email_custom_type: 'Desk Line',
        additional_email_addresses: [
          {
            email_address: `secondary-one-${tenantId}@example.com`,
            custom_type: 'Billing Alias',
            display_order: 0,
          },
        ],
      }, tenantId, trx);

      await ContactModel.createContact({
        full_name: 'Custom Label Contact Two',
        email: `contact-two-${tenantId}@example.com`,
        client_id: clientId,
        additional_email_addresses: [
          {
            email_address: `secondary-two-${tenantId}@example.com`,
            custom_type: '  desk   line  ',
            display_order: 0,
          },
        ],
      }, tenantId, trx);

      const deskLineRows = await trx('contact_email_type_definitions')
        .where({ tenant: tenantId, normalized_label: 'desk line' });
      const billingAliasRows = await trx('contact_email_type_definitions')
        .where({ tenant: tenantId, normalized_label: 'billing alias' });

      expect(deskLineRows).toHaveLength(1);
      expect(billingAliasRows).toHaveLength(1);
    });
  });

  it('T016: identifies and removes orphaned custom email type definitions', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    await db.transaction(async (trx) => {
      const created = await ContactModel.createContact({
        full_name: 'Orphan Label Contact',
        email: `orphan-${tenantId}@example.com`,
        client_id: clientId,
        additional_email_addresses: [
          {
            email_address: `orphaned-${tenantId}@example.com`,
            custom_type: 'Legacy Type',
            display_order: 0,
          },
        ],
      }, tenantId, trx);

      const definition = await trx('contact_email_type_definitions')
        .where({ tenant: tenantId, normalized_label: 'legacy type' })
        .first<{ contact_email_type_id: string }>();

      expect(definition?.contact_email_type_id).toBeDefined();

      await ContactModel.updateContact(created.contact_name_id, {
        additional_email_addresses: [],
      }, tenantId, trx);

      const orphaned = await ContactModel.findOrphanedEmailTypeDefinitions(tenantId, trx);
      const orphanedTypeIds = orphaned.map((entry) => entry.contact_email_type_id);

      expect(orphanedTypeIds).toContain(definition.contact_email_type_id);

      await ContactModel.deleteEmailTypeDefinitions([definition.contact_email_type_id], tenantId, trx);

      const remaining = await trx('contact_email_type_definitions')
        .where({ tenant: tenantId, contact_email_type_id: definition.contact_email_type_id })
        .first();

      expect(remaining).toBeUndefined();
    });
  });
});
