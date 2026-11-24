import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: { user_id: 'u', user_type: 'internal' } as any, perms: new Set<string>(), count: 2 }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(mocks.user, { tenant: '11111111-1111-4111-8111-111111111111' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async (_u: any, resource: string, action: string) => mocks.perms.has(`${resource}:${action}`),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({
    table: () => {
      const b: any = { where: () => b, count: () => b, first: async () => ({ count: String(mocks.count) }) };
      return b;
    },
  }),
}));

import { getOpenQuarantineCountForTicket } from './inboundQuarantineActions';

const TICKET = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  mocks.user = { user_id: 'u', user_type: 'internal' };
  mocks.perms = new Set();
});

describe('getOpenQuarantineCountForTicket', () => {
  it('shows the count to a non-admin internal user with ticket:read, without queue access', async () => {
    mocks.perms = new Set(['ticket:read']);
    expect(await getOpenQuarantineCountForTicket(TICKET)).toEqual({ count: 2, canOpenQueue: false });
  });

  it('flags queue access for an email admin (ticket_settings:update)', async () => {
    mocks.perms = new Set(['ticket:read', 'ticket_settings:update']);
    expect(await getOpenQuarantineCountForTicket(TICKET)).toEqual({ count: 2, canOpenQueue: true });
  });

  it('refuses client-portal users even if they hold ticket:read', async () => {
    mocks.user = { user_id: 'c', user_type: 'client' };
    mocks.perms = new Set(['ticket:read']);
    expect(await getOpenQuarantineCountForTicket(TICKET)).toMatchObject({ permissionError: expect.any(String) });
  });

  it('refuses internal users without ticket:read', async () => {
    expect(await getOpenQuarantineCountForTicket(TICKET)).toMatchObject({ permissionError: expect.any(String) });
  });
});
