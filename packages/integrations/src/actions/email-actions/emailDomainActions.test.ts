import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ allowed: true, domain: { domain_name: 'example.test', status: 'verified' } as any, senders: [{ email_address: 'support@example.test' }], deleted: vi.fn() }));
const hasPermission = vi.hoisted(() => vi.fn(async () => state.allowed));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  tenantDb: () => ({
    table: (name: string) => ({
      where: () => ({
        first: async () => state.domain,
        del: state.deleted,
      }),
      select: async () => name === 'email_sender_addresses' ? state.senders : [],
    }),
  }),
}));

import { deleteEmailDomain } from './emailDomainActions';

describe('deleteEmailDomain sender guard', () => {
  beforeEach(() => {
    state.allowed = true;
    state.domain = { domain_name: 'example.test', status: 'verified' };
    state.senders = [{ email_address: 'support@example.test' }];
    state.deleted.mockClear();
    hasPermission.mockClear();
  });

  it('blocks deleting a domain referenced by a sender', async () => {
    const result = await deleteEmailDomain('example.test');
    expect(JSON.stringify(result)).toMatch(/sender support@example\.test uses it/);
    expect(state.deleted).not.toHaveBeenCalled();
  });

  it('requires settings update permission', async () => {
    state.allowed = false;
    const result = await deleteEmailDomain('example.test');
    expect(JSON.stringify(result)).toMatch(/permission/i);
    expect(state.deleted).not.toHaveBeenCalled();
  });
});
