import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Behavior tests for idempotent customer-tracking resolution. The DB layer is
 * faked in memory: the activities must resolve-or-create against the management
 * tenant without ever mutating an existing client/contact or mis-linking on a
 * name/email collision.
 */

const h = vi.hoisted(() => {
  const MANAGEMENT_TENANT_ID = 'mgmt-tenant-id';
  const MANAGEMENT_TENANT_NAME = 'Nine Minds LLC';

  const state = {
    clients: [] as Array<{ client_id: string; client_name: string }>,
    contacts: [] as Array<{ contact_name_id: string; client_id: string; email: string }>,
    managementTenantId: MANAGEMENT_TENANT_ID,
  };

  const makeQuery = (rows: any[]) => {
    let filtered = rows;
    const query: any = {
      where: (criteria: Record<string, unknown> | string, value?: unknown) => {
        if (typeof criteria === 'string') {
          filtered = filtered.filter((row) => row[criteria] === value);
          return query;
        }
        const entries = Object.entries(criteria);
        filtered = filtered.filter((row) => entries.every(([key, field]) => row[key] === field));
        return query;
      },
      select: () => query,
      first: async () => filtered[0],
      then: (resolve: (value: any[]) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(filtered).then(resolve, reject),
    };
    return query;
  };

  const tenantDb = (_knex: unknown, _tenant: string) => ({
    table: (table: string) => {
      if (table === 'tenants') {
        return makeQuery([{ client_name: MANAGEMENT_TENANT_NAME, tenant: MANAGEMENT_TENANT_ID }]);
      }
      if (table === 'clients') return makeQuery(state.clients);
      if (table === 'contacts') return makeQuery(state.contacts);
      return makeQuery([]);
    },
    unscoped: (_table: string, _reason: string) =>
      makeQuery([{ client_name: MANAGEMENT_TENANT_NAME, tenant: MANAGEMENT_TENANT_ID }]),
  });

  const fakeKnex = {
    transaction: async (callback: (trx: unknown) => unknown) => callback({}),
  };

  return { state, tenantDb, fakeKnex, MANAGEMENT_TENANT_ID };
});

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }),
  },
}));

vi.mock('@alga-psa/db', () => ({ tenantDb: h.tenantDb }));

vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: vi.fn(async () => h.fakeKnex),
  withAdminTransactionRetryReadOnly: vi.fn(),
  retryOnAdminReadOnly: vi.fn(),
}));

vi.mock('@alga-psa/shared/models/clientModel.js', () => ({
  ClientModel: { createClient: vi.fn() },
}));
vi.mock('@alga-psa/shared/models/contactModel.js', () => ({
  ContactModel: { createContact: vi.fn() },
}));
vi.mock('@alga-psa/shared/models/tagModel.js', () => ({
  TagModel: { createTag: vi.fn() },
}));

import { ClientModel } from '@alga-psa/shared/models/clientModel.js';
import { ContactModel } from '@alga-psa/shared/models/contactModel.js';
import {
  AmbiguousCustomerMatchError,
  ContactEmailConflictError,
  createCustomerClientActivity,
  createCustomerContactActivity,
} from '../customer-tracking-activities.js';

const createClientMock = vi.mocked(ClientModel.createClient);
const createContactMock = vi.mocked(ContactModel.createContact);

describe('customer tracking activity idempotency', () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createContactMock.mockReset();
    h.state.clients = [];
    h.state.contacts = [];
  });

  describe('createCustomerClientActivity', () => {
    it('reuses an existing exact-name client without touching it', async () => {
      h.state.clients = [{ client_id: 'client-existing', client_name: 'CloudVBS' }];

      const result = await createCustomerClientActivity({
        tenantName: 'CloudVBS',
        adminUserEmail: 'admin@cloudvbs.test',
      });

      expect(result).toEqual({ customerId: 'client-existing', reused: true });
      expect(createClientMock).not.toHaveBeenCalled();
    });

    it('creates a client when no exact-name match exists', async () => {
      createClientMock.mockResolvedValueOnce({ client_id: 'client-new' } as any);

      const result = await createCustomerClientActivity({
        tenantName: 'Brand New MSP',
        adminUserEmail: 'admin@new.test',
      });

      expect(result).toEqual({ customerId: 'client-new', reused: false });
      expect(createClientMock).toHaveBeenCalledTimes(1);
    });

    it('refuses to link when two clients share the exact name', async () => {
      h.state.clients = [
        { client_id: 'client-a', client_name: 'Collision Co' },
        { client_id: 'client-b', client_name: 'Collision Co' },
      ];

      const error = await createCustomerClientActivity({
        tenantName: 'Collision Co',
        adminUserEmail: 'admin@collision.test',
      }).catch((err) => err);

      expect(error).toBeInstanceOf(AmbiguousCustomerMatchError);
      expect((error as AmbiguousCustomerMatchError).candidateClientIds).toEqual([
        'client-a',
        'client-b',
      ]);
      expect(createClientMock).not.toHaveBeenCalled();
    });

    it('re-reads after losing the insert race and reuses the winner', async () => {
      createClientMock.mockImplementationOnce(async () => {
        h.state.clients.push({ client_id: 'client-raced', client_name: 'Race Co' });
        const error: any = new Error('duplicate key value violates unique constraint');
        error.code = '23505';
        error.constraint = 'clients_tenant_client_name_unique';
        throw error;
      });

      const result = await createCustomerClientActivity({
        tenantName: 'Race Co',
        adminUserEmail: 'admin@race.test',
      });

      expect(result).toEqual({ customerId: 'client-raced', reused: true });
    });
  });

  describe('createCustomerContactActivity', () => {
    it('reuses an existing contact under the same client, normalizing email case', async () => {
      h.state.contacts = [
        { contact_name_id: 'contact-existing', client_id: 'client-1', email: 'admin@cloudvbs.test' },
      ];

      const result = await createCustomerContactActivity({
        clientId: 'client-1',
        firstName: 'Ada',
        lastName: 'Admin',
        email: '  Admin@CloudVBS.test  ',
      });

      expect(result).toEqual({ contactId: 'contact-existing', reused: true });
      expect(createContactMock).not.toHaveBeenCalled();
    });

    it('creates a contact when none exists for the client', async () => {
      createContactMock.mockResolvedValueOnce({ contact_name_id: 'contact-new' } as any);

      const result = await createCustomerContactActivity({
        clientId: 'client-1',
        firstName: 'Ada',
        lastName: 'Admin',
        email: 'ada@new.test',
      });

      expect(result).toEqual({ contactId: 'contact-new', reused: false });
      expect(createContactMock).toHaveBeenCalledTimes(1);
    });

    it('re-reads after losing the insert race and reuses the winner', async () => {
      createContactMock.mockImplementationOnce(async () => {
        h.state.contacts.push({
          contact_name_id: 'contact-raced',
          client_id: 'client-1',
          email: 'raced@test.test',
        });
        const error: any = new Error('duplicate key value violates unique constraint');
        error.code = '23505';
        error.constraint = 'contacts_tenant_email_unique';
        throw error;
      });

      const result = await createCustomerContactActivity({
        clientId: 'client-1',
        firstName: 'Race',
        lastName: 'Contact',
        email: 'raced@test.test',
      });

      expect(result).toEqual({ contactId: 'contact-raced', reused: true });
    });

    it('refuses to reuse an email owned by a different client', async () => {
      // contacts.email is unique per tenant, so the same email under another
      // client makes ContactModel.createContact fail with EMAIL_EXISTS.
      h.state.contacts = [
        { contact_name_id: 'other-contact', client_id: 'client-other', email: 'shared@test.test' },
      ];
      createContactMock.mockRejectedValueOnce(
        new Error('EMAIL_EXISTS: A contact with this email address already exists in the system'),
      );

      const error = await createCustomerContactActivity({
        clientId: 'client-1',
        firstName: 'Shared',
        lastName: 'Email',
        email: 'shared@test.test',
      }).catch((err) => err);

      expect(error).toBeInstanceOf(ContactEmailConflictError);
      expect((error as ContactEmailConflictError).existingClientId).toBe('client-other');
    });
  });
});
