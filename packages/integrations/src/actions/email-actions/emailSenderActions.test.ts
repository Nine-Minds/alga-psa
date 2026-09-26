import { beforeEach, describe, expect, it, vi } from 'vitest';

const allowed = vi.hoisted(() => ({ value: true }));
const routes = vi.hoisted(() => [] as any[]);
const hasPermissionMock = vi.hoisted(() => vi.fn(async () => allowed.value));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1', email: 'admin@example.test' }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: hasPermissionMock }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  tenantDb: () => ({
    table: (name: string) => ({
      where: () => ({
        select: vi.fn(async () => name === 'email_sender_routes' ? routes : []),
        first: vi.fn(async () => null),
        del: vi.fn(async () => 1),
      }),
    }),
  }),
}));
vi.mock('@alga-psa/email', () => ({ TenantEmailService: { invalidateTenantSettings: vi.fn() } }));

import { deleteEmailSender, listEmailSenders } from './emailSenderActions';

describe('email sender actions', () => {
  beforeEach(() => {
    allowed.value = true;
    routes.splice(0, routes.length);
    hasPermissionMock.mockClear();
  });

  it('denies sender reads when settings:read is missing', async () => {
    allowed.value = false;
    await expect(listEmailSenders()).rejects.toThrow(/permission/i);
    expect(hasPermissionMock).toHaveBeenCalledWith(expect.anything(), 'settings', 'read', expect.anything());
  });

  it('blocks deletion while a sender is routed', async () => {
    routes.push({ route_type: 'mail_class', mail_class: 'ticket', board_id: null });
    await expect(deleteEmailSender('sender-1')).rejects.toThrow(/ticket/);
  });
});
