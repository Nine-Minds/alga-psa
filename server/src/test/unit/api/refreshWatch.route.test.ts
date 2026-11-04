import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), getAdminConnection: vi.fn(), tenantDb: vi.fn(),
  hasPermission: vi.fn(), configureGmailProvider: vi.fn(),
  table: vi.fn(), where: vi.fn(), first: vi.fn(), knex: {},
}));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: mocks.getAdminConnection }));
vi.mock('@alga-psa/db', () => ({ tenantDb: mocks.tenantDb }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/integrations/actions/email-actions/configureGmailProvider', () => ({
  configureGmailProvider: mocks.configureGmailProvider,
}));
import { POST } from '../../../app/api/email/refresh-watch/route';

const user = { user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1' };
const request = () => new NextRequest('http://localhost/api/email/refresh-watch', {
  method: 'POST', body: JSON.stringify({ providerId: 'provider-1', tenant: 'untrusted-tenant' }),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ ...user });
  mocks.getAdminConnection.mockResolvedValue(mocks.knex);
  mocks.hasPermission.mockImplementation(async (_user, resource, action) =>
    resource === 'ticket_settings' && action === 'update');
  const query = { where: mocks.where, first: mocks.first };
  mocks.tenantDb.mockReturnValue({ table: mocks.table });
  mocks.table.mockReturnValue(query);
  mocks.where.mockReturnValue(query);
  mocks.first
    .mockResolvedValueOnce({ id: 'provider-1', tenant: 'tenant-1', mailbox: 'inbox@example.test' })
    .mockResolvedValueOnce({ project_id: 'project-1' });
  mocks.configureGmailProvider.mockResolvedValue({ success: true });
});

function expectNoProviderWork() {
  expect(mocks.tenantDb).not.toHaveBeenCalled();
  expect(mocks.configureGmailProvider).not.toHaveBeenCalled();
}

describe('POST /api/email/refresh-watch authorization', () => {
  it('returns 401 without a session before database or external work', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.getAdminConnection).not.toHaveBeenCalled();
    expectNoProviderWork();
  });
  it('refuses client users even when they would hold the permission', async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...user, user_type: 'client' });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expectNoProviderWork();
  });
  it('refuses internal users missing ticket_settings:update before provider lookup', async () => {
    mocks.hasPermission.mockResolvedValue(false);
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain('ticket_settings:update');
    expect(mocks.hasPermission).toHaveBeenCalledWith(user, 'ticket_settings', 'update', mocks.knex);
    expectNoProviderWork();
  });
  it('lets authorized internal users force refresh using the authenticated tenant', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, providerId: 'provider-1' });
    expect(mocks.hasPermission).toHaveBeenCalledWith(user, 'ticket_settings', 'update', mocks.knex);
    expect(mocks.tenantDb).toHaveBeenCalledWith(mocks.knex, 'tenant-1');
    expect(mocks.table.mock.calls).toEqual([['email_providers'], ['google_email_provider_config']]);
    expect(mocks.where.mock.calls).toEqual([
      ['id', 'provider-1'], ['provider_type', 'google'], ['is_active', true],
      ['email_provider_id', 'provider-1'],
    ]);
    expect(mocks.configureGmailProvider).toHaveBeenCalledExactlyOnceWith({
      tenant: 'tenant-1', providerId: 'provider-1', projectId: 'project-1', force: true,
    });
  });
});
