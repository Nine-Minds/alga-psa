import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { ContactModel, EmailOwnershipError } from '@alga-psa/shared/models/contactModel';
import { resolveContactEmailOwnership } from '@alga-psa/shared/models/contactEmailOwnership';

async function createTenant(db: Knex) {
  const tenantId = uuidv4();
  await db('tenants').insert({
    tenant: tenantId,
    client_name: `Ownership Tenant ${tenantId.slice(0, 6)}`,
    email: `${tenantId.slice(0, 6)}@example.com`,
  });
  return tenantId;
}

async function createClient(db: Knex, tenantId: string, name: string) {
  const clientId = uuidv4();
  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: name,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return clientId;
}

describe('contact email ownership (resolver + ContactModel.createContact)', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  describe('resolveContactEmailOwnership', () => {
    it('finds the owner of a primary email, with its client name', async () => {
      const tenant = await createTenant(db);
      const clientId = await createClient(db, tenant, 'Muscle Corp');
      await db.transaction(async (trx) => {
        const owner = await ContactModel.createContact(
          { full_name: 'Benjamin Dixon', email: 'ben@muscle.ca', client_id: clientId },
          tenant,
          trx
        );

        await expect(resolveContactEmailOwnership(tenant, 'ben@muscle.ca', trx)).resolves.toEqual({
          kind: 'primary',
          contactNameId: owner.contact_name_id,
          clientId,
          fullName: 'Benjamin Dixon',
          clientName: 'Muscle Corp',
          isInactive: false,
        });
      });
    });

    it('finds the owner of an additional email', async () => {
      const tenant = await createTenant(db);
      const clientId = await createClient(db, tenant, 'Acme');
      await db.transaction(async (trx) => {
        const owner = await ContactModel.createContact(
          {
            full_name: 'Alice Owner',
            email: 'alice@acme.test',
            client_id: clientId,
            additional_email_addresses: [{ email_address: 'billing@acme.test', canonical_type: 'work', display_order: 0 }],
          },
          tenant,
          trx
        );

        await expect(resolveContactEmailOwnership(tenant, 'billing@acme.test', trx)).resolves.toMatchObject({
          kind: 'additional',
          contactNameId: owner.contact_name_id,
          clientName: 'Acme',
        });
      });
    });

    it('reports a contact with no client as clientId and clientName null', async () => {
      const tenant = await createTenant(db);
      await db.transaction(async (trx) => {
        await ContactModel.createContact({ full_name: 'Clientless', email: 'free@nowhere.test' }, tenant, trx);
        await expect(resolveContactEmailOwnership(tenant, 'free@nowhere.test', trx)).resolves.toMatchObject({
          clientId: null,
          clientName: null,
        });
      });
    });

    it('reports an inactive owner', async () => {
      const tenant = await createTenant(db);
      const clientId = await createClient(db, tenant, 'Acme');
      await db.transaction(async (trx) => {
        await ContactModel.createContact(
          { full_name: 'Gone Away', email: 'gone@acme.test', client_id: clientId, is_inactive: true },
          tenant,
          trx
        );
        await expect(resolveContactEmailOwnership(tenant, 'gone@acme.test', trx)).resolves.toMatchObject({ isInactive: true });
      });
    });

    it('matches regardless of case and surrounding whitespace, including legacy mixed-case rows', async () => {
      const tenant = await createTenant(db);
      const clientId = await createClient(db, tenant, 'Acme');
      await db.transaction(async (trx) => {
        const owner = await ContactModel.createContact(
          { full_name: 'Case Test', email: 'case@acme.test', client_id: clientId },
          tenant,
          trx
        );
        await expect(resolveContactEmailOwnership(tenant, '  CASE@Acme.TEST  ', trx)).resolves.toMatchObject({
          contactNameId: owner.contact_name_id,
        });

        await trx('contacts').where({ tenant, contact_name_id: owner.contact_name_id }).update({ email: 'Case@Acme.Test' });
        await expect(resolveContactEmailOwnership(tenant, 'case@acme.test', trx)).resolves.toMatchObject({
          contactNameId: owner.contact_name_id,
        });
        await expect(resolveContactEmailOwnership(tenant, '   ', trx)).resolves.toBeNull();
      });
    });

    it('never answers across tenants', async () => {
      const tenantA = await createTenant(db);
      const tenantB = await createTenant(db);
      const clientA = await createClient(db, tenantA, 'Tenant A Client');
      await db.transaction(async (trx) => {
        await ContactModel.createContact({ full_name: 'Only In A', email: 'same@both.test', client_id: clientA }, tenantA, trx);

        await expect(resolveContactEmailOwnership(tenantB, 'same@both.test', trx)).resolves.toBeNull();
        await expect(resolveContactEmailOwnership(tenantA, 'same@both.test', trx)).resolves.not.toBeNull();
      });
    });
  });

  describe('ContactModel.createContact', () => {
    it('creates a contact when nobody owns the email', async () => {
      const tenant = await createTenant(db);
      const clientId = await createClient(db, tenant, 'Acme');
      await db.transaction(async (trx) => {
        const created = await ContactModel.createContact(
          { full_name: 'Fresh Contact', email: 'fresh@acme.test', client_id: clientId },
          tenant,
          trx
        );
        expect(created.email).toBe('fresh@acme.test');
      });
    });

    it('throws a structured conflict for a primary-email owner, keeping the EMAIL_EXISTS prefix and generic text', async () => {
      const tenant = await createTenant(db);
      const clientId = await createClient(db, tenant, 'Muscle Corp');
      await db.transaction(async (trx) => {
        const owner = await ContactModel.createContact(
          { full_name: 'Benjamin Dixon', email: 'ben@muscle.ca', client_id: clientId },
          tenant,
          trx
        );

        const error = await ContactModel.createContact(
          { full_name: 'Someone Else', email: 'BEN@muscle.ca', client_id: clientId },
          tenant,
          trx
        ).catch((e) => e);

        expect(error).toBeInstanceOf(EmailOwnershipError);
        expect(error.message).toBe('EMAIL_EXISTS: A contact with this email address already exists in the system');
        expect(error.conflict).toMatchObject({
          kind: 'primary',
          contactNameId: owner.contact_name_id,
          fullName: 'Benjamin Dixon',
          clientName: 'Muscle Corp',
        });
      });
    });

    it('throws a structured conflict for an additional-email owner', async () => {
      const tenant = await createTenant(db);
      const clientId = await createClient(db, tenant, 'Acme');
      await db.transaction(async (trx) => {
        const owner = await ContactModel.createContact(
          {
            full_name: 'Alice Owner',
            email: 'alice@acme.test',
            client_id: clientId,
            additional_email_addresses: [{ email_address: 'billing@acme.test', canonical_type: 'work', display_order: 0 }],
          },
          tenant,
          trx
        );

        const error = await ContactModel.createContact(
          { full_name: 'Newcomer', email: 'billing@acme.test', client_id: clientId },
          tenant,
          trx
        ).catch((e) => e);

        expect(error).toBeInstanceOf(EmailOwnershipError);
        expect(error.message.startsWith('EMAIL_EXISTS: ')).toBe(true);
        expect(error.conflict).toMatchObject({ kind: 'additional', contactNameId: owner.contact_name_id });
      });
    });

    it('a unique-constraint race resolves the owner and throws the same structured error', async () => {
      const tenant = await createTenant(db);
      const clientId = await createClient(db, tenant, 'Race Corp');
      const email = 'race@racecorp.test';

      // A inserts and holds its transaction open; B passes its pre-check (A is uncommitted), then blocks on the
      // unique index until A commits, and so fails at INSERT time, not at the pre-check.
      const trxA = await db.transaction();
      const trxB = await db.transaction();
      try {
        const winner = await ContactModel.createContact({ full_name: 'Winner', email, client_id: clientId }, tenant, trxA);
        const loser = ContactModel.createContact({ full_name: 'Loser', email, client_id: clientId }, tenant, trxB).catch((e) => e);
        await new Promise((resolve) => setTimeout(resolve, 400));
        await trxA.commit();

        const error = await loser;
        expect(error).toBeInstanceOf(EmailOwnershipError);
        expect(error.message.startsWith('EMAIL_EXISTS: ')).toBe(true);
        expect(error.conflict).toMatchObject({
          kind: 'primary',
          contactNameId: winner.contact_name_id,
          fullName: 'Winner',
          clientName: 'Race Corp',
        });
        // The savepoint left B's transaction usable after the failed insert.
        await expect(trxB.raw('select 1 as ok')).resolves.toBeTruthy();
      } finally {
        if (!trxA.isCompleted()) await trxA.rollback();
        if (!trxB.isCompleted()) await trxB.rollback();
      }
    });
  });
});
