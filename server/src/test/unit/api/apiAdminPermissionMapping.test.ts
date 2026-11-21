import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ForbiddenError, UnauthorizedError } from '@/lib/api/middleware/apiMiddleware';

const permissionMock = vi.hoisted(() => vi.fn());
const runWithTenantMock = vi.hoisted(() => vi.fn(async (_tenant: string, cb: () => Promise<unknown>) => cb()));

vi.mock('@/lib/api/middleware/apiContextPermission', () => ({ hasApiContextPermission: permissionMock }));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@/lib/db', () => ({ runWithTenant: runWithTenantMock }));

import { ApiMetadataController } from '@/lib/api/controllers/ApiMetadataController';
import { ApiRoleController } from '@/lib/api/controllers/ApiRoleController';
import { ApiPermissionController } from '@/lib/api/controllers/ApiPermissionController';
import { ApiWebhookController } from '@/lib/api/controllers/ApiWebhookController';

const request = (withUser = true) => Object.assign(new NextRequest('http://example.com/api/v1/x'), {
  context: { tenant: 'tenant-1', userId: 'u1', user: withUser ? { user_id: 'u1' } : undefined },
}) as any;

/** The (resource, action) pairs the controller handed to the permission engine. */
const checked = () => permissionMock.mock.calls.map((call) => `${call[1]}:${call[2]}`);

describe('API admin controllers check the intended permission resource', () => {
  beforeEach(() => {
    permissionMock.mockReset();
    permissionMock.mockResolvedValue(true);
  });

  it('metadata → metadata:read via the base checkPermission', async () => {
    await (new ApiMetadataController() as any).checkPermission(request(), 'read');
    expect(checked()).toEqual(['metadata:read']);
  });

  it.each(['read', 'create', 'update', 'delete'])('roles → role:%s via the base checkPermission', async (action) => {
    await (new ApiRoleController() as any).checkPermission(request(), action);
    expect(checked()).toEqual([`role:${action}`]);
  });

  it('rbac audit → role:read', async () => {
    const controller = new ApiPermissionController();
    vi.spyOn(controller as any, 'authenticate').mockResolvedValue(request());
    permissionMock.mockResolvedValue(false);
    const response = await controller.audit()(request());
    expect(checked()).toEqual(['role:read']);
    expect(response.status).toBe(403);
  });

  it.each([
    'read', 'create', 'update', 'delete', 'test', 'retry', 'system_settings', 'analytics',
    'bulk_update', 'manage_subscriptions', 'verify', 'manage_security', 'export', 'trigger',
  ])('webhooks → webhook:%s', async (action) => {
    await (new ApiWebhookController() as any).checkPermission(request(), action);
    expect(checked()).toEqual([`webhook:${action}`]);
  });

  it.each([
    ['metadata', () => new ApiMetadataController()],
    ['role', () => new ApiRoleController()],
    ['webhook', () => new ApiWebhookController()],
  ])('%s keeps Unauthorized/Forbidden behaviour', async (_name, build) => {
    const controller = build() as any;
    await expect(controller.checkPermission(request(false), 'read')).rejects.toBeInstanceOf(UnauthorizedError);
    permissionMock.mockResolvedValue(false);
    await expect(controller.checkPermission(request(), 'read')).rejects.toBeInstanceOf(ForbiddenError);
  });
});
