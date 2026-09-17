import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The EE portal-user activity must reuse an existing client-portal account
 * instead of tripping the shared model's duplicate guard — and must do so
 * without re-hashing a password or re-assigning roles.
 */

const h = vi.hoisted(() => {
  const state = {
    users: [] as Array<Record<string, unknown>>,
    userRoles: [] as Array<Record<string, unknown>>,
    contacts: [] as Array<Record<string, unknown>>,
  };

  const makeQuery = (rows: any[]) => {
    let filtered = rows;
    const query: any = {
      where: (criteria: Record<string, unknown>) => {
        const entries = Object.entries(criteria);
        filtered = filtered.filter((row) => entries.every(([key, value]) => row[key] === value));
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
      if (table === 'users') return makeQuery(state.users);
      if (table === 'user_roles') return makeQuery(state.userRoles);
      if (table === 'contacts') return makeQuery(state.contacts);
      return makeQuery([]);
    },
  });

  return { state, tenantDb };
});

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }),
  },
}));

vi.mock('@alga-psa/db', () => ({ tenantDb: h.tenantDb }));

vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: vi.fn(async () => ({})),
  retryOnAdminReadOnly: vi.fn(async (fn: () => unknown) => fn()),
  withAdminTransactionRetryReadOnly: vi.fn(),
}));

vi.mock('@alga-psa/shared/models/userModel.js', () => ({
  createPortalUserInDB: vi.fn(),
}));

vi.mock('@alga-psa/core/encryption', () => ({
  generateSecurePassword: vi.fn(() => 'generated-password'),
  hashPassword: vi.fn(),
}));

import { createPortalUserInDB as createPortalUserInSharedModel } from '@alga-psa/shared/models/userModel.js';
import { generateSecurePassword } from '@alga-psa/core/encryption';
import {
  createPortalUserInDB,
  PortalUserIdentityMismatchError,
} from '../../db/portal-user-operations.js';

const sharedCreateMock = vi.mocked(createPortalUserInSharedModel);
const generatePasswordMock = vi.mocked(generateSecurePassword);

const baseInput = {
  tenantId: 'mgmt-tenant',
  email: 'Admin@CloudVBS.test',
  password: 'temp-password',
  contactId: 'contact-1',
  clientId: 'client-1',
  firstName: 'Ada',
  lastName: 'Admin',
  isClientAdmin: true,
};

describe('createPortalUserInDB reuse behavior', () => {
  beforeEach(() => {
    sharedCreateMock.mockReset();
    generatePasswordMock.mockReset();
    generatePasswordMock.mockReturnValue('generated-password');
    h.state.users = [];
    h.state.userRoles = [];
    h.state.contacts = [{ contact_name_id: 'contact-1', client_id: 'client-1' }];
  });

  it('returns the existing client-portal account without re-hashing or re-roling', async () => {
    h.state.users = [
      {
        user_id: 'portal-existing',
        email: 'admin@cloudvbs.test',
        user_type: 'client',
        is_inactive: false,
        contact_id: 'contact-1',
        password_hash: 'original-hash',
      },
    ];
    h.state.userRoles = [{ user_id: 'portal-existing', role_id: 'role-existing' }];

    const result = await createPortalUserInDB(baseInput);

    expect(result).toEqual({
      userId: 'portal-existing',
      roleId: 'role-existing',
      status: 'existing',
    });
    expect(sharedCreateMock).not.toHaveBeenCalled();
    expect(generatePasswordMock).not.toHaveBeenCalled();
    // Nothing about the existing account or its grants was touched.
    expect(h.state.users).toHaveLength(1);
    expect(h.state.users[0]).toMatchObject({
      password_hash: 'original-hash',
      is_inactive: false,
      contact_id: 'contact-1',
    });
    expect(h.state.userRoles).toEqual([{ user_id: 'portal-existing', role_id: 'role-existing' }]);
  });

  it('creates a portal user when none exists and reports created', async () => {
    sharedCreateMock.mockResolvedValueOnce({
      success: true,
      userId: 'portal-new',
      roleId: 'role-new',
    });

    const result = await createPortalUserInDB({ ...baseInput, password: undefined });

    expect(result).toMatchObject({
      userId: 'portal-new',
      roleId: 'role-new',
      status: 'created',
      temporaryPassword: 'generated-password',
    });
    expect(sharedCreateMock).toHaveBeenCalledTimes(1);
  });

  it('converges on an existing account when it loses the concurrent insert race', async () => {
    sharedCreateMock.mockImplementationOnce(async () => {
      h.state.users.push({
        user_id: 'portal-raced',
        email: 'admin@cloudvbs.test',
        user_type: 'client',
        is_inactive: false,
        contact_id: 'contact-1',
      });
      h.state.userRoles.push({ user_id: 'portal-raced', role_id: 'role-raced' });
      return { success: false, error: 'A client portal user with this email already exists' };
    });

    const result = await createPortalUserInDB(baseInput);

    expect(result).toEqual({
      userId: 'portal-raced',
      roleId: 'role-raced',
      status: 'existing',
    });
  });

  it('refuses to reuse a portal account linked to a different contact/client', async () => {
    // The email matches, but the account grants access to a different
    // customer. Returning `existing` would report working portal access for
    // the wrong record, so the activity refuses and changes nothing.
    h.state.users = [
      {
        user_id: 'portal-other',
        email: 'admin@cloudvbs.test',
        user_type: 'client',
        is_inactive: false,
        contact_id: 'other-contact',
      },
    ];
    h.state.userRoles = [{ user_id: 'portal-other', role_id: 'other-role' }];
    h.state.contacts = [{ contact_name_id: 'other-contact', client_id: 'other-client' }];

    const error = await createPortalUserInDB(baseInput).catch((err) => err);

    expect(error).toBeInstanceOf(PortalUserIdentityMismatchError);
    expect((error as PortalUserIdentityMismatchError).existingUserId).toBe('portal-other');
    expect((error as PortalUserIdentityMismatchError).expectedClientId).toBe('client-1');
    expect(sharedCreateMock).not.toHaveBeenCalled();
    expect(generatePasswordMock).not.toHaveBeenCalled();
    // Nothing about the existing account was mutated.
    expect(h.state.users).toHaveLength(1);
    expect(h.state.userRoles).toEqual([{ user_id: 'portal-other', role_id: 'other-role' }]);
  });

  it('refuses when the linked contact now belongs to a different client', async () => {
    // The portal account points at the resolved contact id, but that contact
    // moved to another client. The client half of the identity check must
    // still refuse rather than report access under the wrong customer.
    h.state.users = [
      {
        user_id: 'portal-moved',
        email: 'admin@cloudvbs.test',
        user_type: 'client',
        is_inactive: false,
        contact_id: 'contact-1',
      },
    ];
    h.state.userRoles = [{ user_id: 'portal-moved', role_id: 'role-moved' }];
    h.state.contacts = [{ contact_name_id: 'contact-1', client_id: 'other-client' }];

    const error = await createPortalUserInDB(baseInput).catch((err) => err);

    expect(error).toBeInstanceOf(PortalUserIdentityMismatchError);
    expect((error as PortalUserIdentityMismatchError).existingContactId).toBe('contact-1');
    expect((error as PortalUserIdentityMismatchError).expectedClientId).toBe('client-1');
    expect(sharedCreateMock).not.toHaveBeenCalled();
    expect(h.state.userRoles).toEqual([{ user_id: 'portal-moved', role_id: 'role-moved' }]);
  });

  it('refuses to reuse an unlinked legacy portal account', async () => {
    // A portal account with no contact linkage cannot be proven to belong to
    // this customer; refuse and leave it untouched.
    h.state.users = [
      {
        user_id: 'portal-unlinked',
        email: 'admin@cloudvbs.test',
        user_type: 'client',
        is_inactive: false,
        contact_id: null,
      },
    ];
    h.state.userRoles = [{ user_id: 'portal-unlinked', role_id: 'role-unlinked' }];

    const error = await createPortalUserInDB(baseInput).catch((err) => err);

    expect(error).toBeInstanceOf(PortalUserIdentityMismatchError);
    expect((error as PortalUserIdentityMismatchError).existingContactId).toBeNull();
    expect(sharedCreateMock).not.toHaveBeenCalled();
    expect(h.state.userRoles).toEqual([{ user_id: 'portal-unlinked', role_id: 'role-unlinked' }]);
  });
});
