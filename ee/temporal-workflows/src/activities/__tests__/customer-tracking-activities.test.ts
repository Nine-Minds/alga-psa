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
    clients: [] as Array<{ client_id: string; client_name: string; properties?: unknown }>,
    contacts: [] as Array<{ contact_name_id: string; client_id: string; email: string }>,
    users: [] as Array<{
      user_id: string;
      contact_id: string | null;
      user_type: string;
      email: string;
    }>,
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
      andWhere: (criteria: Record<string, unknown>) => {
        const entries = Object.entries(criteria);
        filtered = filtered.filter((row) => entries.every(([key, field]) => row[key] === field));
        return query;
      },
      whereIn: (column: string, values: unknown[]) => {
        filtered = filtered.filter((row) => values.includes(row[column]));
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
      if (table === 'users') return makeQuery(state.users);
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
  UnverifiedCustomerMatchError,
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
    h.state.users = [];
  });

  describe('createCustomerClientActivity', () => {
    it('reuses an existing exact-name client the admin is an existing contact of', async () => {
      h.state.clients = [{ client_id: 'client-existing', client_name: 'CloudVBS' }];
      h.state.contacts = [
        { contact_name_id: 'contact-existing', client_id: 'client-existing', email: 'admin@cloudvbs.test' },
      ];

      const result = await createCustomerClientActivity({
        tenantName: 'CloudVBS',
        adminUserEmail: 'admin@cloudvbs.test',
      });

      expect(result).toEqual({ customerId: 'client-existing', reused: true });
      expect(createClientMock).not.toHaveBeenCalled();
    });

    it('reuses a client the admin holds a linked client-portal account under', async () => {
      // Trust can also come from a client-portal user attached to the client's
      // contact, not only from the contact email itself. This exercises the
      // portal-user branch of the association lookup.
      h.state.clients = [{ client_id: 'portal-client', client_name: 'Portal Access Co' }];
      h.state.contacts = [
        {
          contact_name_id: 'portal-contact',
          client_id: 'portal-client',
          email: 'billing@portalaccess.test',
        },
      ];
      h.state.users = [
        {
          user_id: 'portal-user-1',
          contact_id: 'portal-contact',
          user_type: 'client',
          email: 'admin@portalaccess.test',
        },
      ];

      const result = await createCustomerClientActivity({
        tenantName: 'Portal Access Co',
        adminUserEmail: 'Admin@PortalAccess.test',
      });

      expect(result).toEqual({ customerId: 'portal-client', reused: true });
      expect(createClientMock).not.toHaveBeenCalled();
    });

    it('reuses a client whose marker tenant_uuid matches even when the admin email differs', async () => {
      // The marker's tenant UUID identifies the same provisioning run, so a
      // re-run that changed the admin address still recognizes its own client.
      h.state.clients = [
        {
          client_id: 'uuid-client',
          client_name: 'UUID Bound Co',
          properties: {
            onboarding_association: {
              admin_email: 'original-admin@uuidbound.test',
              tenant_uuid: 'tenant-uuid-bound',
            },
          },
        },
      ];

      const result = await createCustomerClientActivity({
        tenantName: 'UUID Bound Co',
        adminUserEmail: 'new-admin@uuidbound.test',
        tenantId: 'tenant-uuid-bound',
      });

      expect(result).toEqual({ customerId: 'uuid-client', reused: true });
      expect(createClientMock).not.toHaveBeenCalled();
    });

    it('refuses an exact-name client with no trusted association (Harbor Point regression)', async () => {
      // The original defect: an unrelated signup with a colliding company name
      // was linked to the pre-existing client and granted a portal account
      // because the names matched. The activity must refuse on the name alone
      // and mutate nothing.
      h.state.clients = [
        { client_id: 'harbor-client', client_name: 'Harbor Point IT', properties: {} },
      ];
      h.state.contacts = [
        { contact_name_id: 'harbor-contact', client_id: 'harbor-client', email: 'owner@harborpoint.test' },
      ];

      const error = await createCustomerClientActivity({
        tenantName: 'Harbor Point IT',
        adminUserEmail: 'unrelated-20260914@namecollision.smoke',
        tenantId: 'brand-new-tenant-uuid',
      }).catch((err) => err);

      expect(error).toBeInstanceOf(UnverifiedCustomerMatchError);
      expect((error as UnverifiedCustomerMatchError).existingClientId).toBe('harbor-client');
      expect(createClientMock).not.toHaveBeenCalled();
      // No contact or portal-user row was attached for the unrelated email.
      expect(createContactMock).not.toHaveBeenCalled();
      expect(h.state.contacts).toHaveLength(1);
      expect(h.state.contacts[0].email).toBe('owner@harborpoint.test');
      expect(h.state.users).toHaveLength(0);
    });

    it('reuses its own association marker before any contact exists (retry)', async () => {
      // A previous run of this same onboarding created the client but failed
      // before the contact: only the marker ties the client to this admin.
      h.state.clients = [
        {
          client_id: 'partial-client',
          client_name: 'Partial Co',
          properties: {
            onboarding_association: { admin_email: 'admin@partial.test', tenant_uuid: 'tenant-uuid-1' },
          },
        },
      ];

      const result = await createCustomerClientActivity({
        tenantName: 'Partial Co',
        adminUserEmail: 'Admin@Partial.test',
        tenantId: 'tenant-uuid-1',
      });

      expect(result).toEqual({ customerId: 'partial-client', reused: true });
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
      // The created client carries the association marker so a retry or a
      // concurrent duplicate can recognize it before any contact exists.
      const createArg = createClientMock.mock.calls[0]?.[0] as any;
      expect(createArg.properties.onboarding_association).toMatchObject({
        admin_email: 'admin@new.test',
      });
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

    it('still refuses as ambiguous when one same-name candidate is trusted', async () => {
      // Multiple exact-name clients must refuse *before* any association check:
      // even a candidate the admin is a contact of cannot be picked out of the
      // set, so the ambiguity guard has to win.
      h.state.clients = [
        { client_id: 'client-a', client_name: 'Collision Co' },
        { client_id: 'client-b', client_name: 'Collision Co' },
      ];
      h.state.contacts = [
        { contact_name_id: 'contact-a', client_id: 'client-a', email: 'admin@collision.test' },
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

    it('reads the association marker when properties arrives as a JSON string', async () => {
      // jsonb normally deserializes to an object, but a driver/pool can hand
      // back the raw text; the marker must survive either shape.
      h.state.clients = [
        {
          client_id: 'string-props-client',
          client_name: 'String Props Co',
          properties: JSON.stringify({
            onboarding_association: { admin_email: 'admin@stringprops.test', tenant_uuid: 'string-uuid' },
          }),
        },
      ];

      const result = await createCustomerClientActivity({
        tenantName: 'String Props Co',
        adminUserEmail: ' ADMIN@StringProps.test ',
        tenantId: 'string-uuid',
      });

      expect(result).toEqual({ customerId: 'string-props-client', reused: true });
      expect(createClientMock).not.toHaveBeenCalled();
    });

    it('re-reads after losing the insert race and reuses its own winner', async () => {
      createClientMock.mockImplementationOnce(async () => {
        // The winning run is the same onboarding: it wrote the marker.
        h.state.clients.push({
          client_id: 'client-raced',
          client_name: 'Race Co',
          properties: {
            onboarding_association: { admin_email: 'admin@race.test', tenant_uuid: 'race-uuid' },
          },
        });
        const error: any = new Error('duplicate key value violates unique constraint');
        error.code = '23505';
        error.constraint = 'clients_tenant_client_name_unique';
        throw error;
      });

      const result = await createCustomerClientActivity({
        tenantName: 'Race Co',
        adminUserEmail: 'admin@race.test',
        tenantId: 'race-uuid',
      });

      expect(result).toEqual({ customerId: 'client-raced', reused: true });
      expect(createClientMock).toHaveBeenCalledTimes(1);
    });

    it('refuses an unrelated client re-read after the insert race', async () => {
      // Pre-check sees nothing, the insert trips the unique constraint, and the
      // re-read finds the colliding client a different onboarding owns. The
      // trust check must run on this path too.
      createClientMock.mockImplementationOnce(async () => {
        h.state.clients.push({
          client_id: 'harbor-raced',
          client_name: 'Harbor Point IT',
          properties: {},
        });
        h.state.contacts.push({
          contact_name_id: 'harbor-owned',
          client_id: 'harbor-raced',
          email: 'owner@harborpoint.test',
        });
        const error: any = new Error('duplicate key value violates unique constraint');
        error.code = '23505';
        error.constraint = 'clients_tenant_client_name_unique';
        throw error;
      });

      const error = await createCustomerClientActivity({
        tenantName: 'Harbor Point IT',
        adminUserEmail: 'unrelated-race@namecollision.smoke',
        tenantId: 'different-tenant-uuid',
      }).catch((err) => err);

      expect(error).toBeInstanceOf(UnverifiedCustomerMatchError);
      expect((error as UnverifiedCustomerMatchError).existingClientId).toBe('harbor-raced');
      expect(createClientMock).toHaveBeenCalledTimes(1);
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
