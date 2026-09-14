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
  };

  const makeQuery = (rows: any[]) => {
    let filtered = rows;
    const query: any = {
      where: (criteria: Record<string, unknown>) => {
        const entries = Object.entries(criteria);
        filtered = filtered.filter((row) => entries.every(([key, value]) => row[key] === value));
        return query;
      },
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
import { createPortalUserInDB } from '../../db/portal-user-operations.js';

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
  });

  it('returns the existing client-portal account without re-hashing or re-roling', async () => {
    h.state.users = [
      { user_id: 'portal-existing', email: 'admin@cloudvbs.test', user_type: 'client', is_inactive: false },
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
});
