/**
 * T037 (CE build, oss entry) — key-gate half, packages/auth copy of getKeyGateReason.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userRow: null as Record<string, unknown> | null,
  isTenantSuspended: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  isTenantSuspended: mocks.isTenantSuspended,
  tenantDb: () => ({
    table: () => {
      const builder: any = { where: () => builder, first: async () => mocks.userRow };
      return builder;
    },
  }),
}));

import { ApiKeyService } from './apiKeyService';

const gate = (): Promise<string | null> =>
  (ApiKeyService as any).getKeyGateReason({}, 'tenant-1', 'owner-1');

describe('T037: ApiKeyService.getKeyGateReason allow-list (oss entry)', () => {
  beforeEach(() => {
    mocks.isTenantSuspended.mockReset().mockResolvedValue(false);
  });

  it('passes an active internal owner', async () => {
    mocks.userRow = { is_inactive: false, user_type: 'internal' };
    await expect(gate()).resolves.toBeNull();
  });

  it('rejects a client owner', async () => {
    mocks.userRow = { is_inactive: false, user_type: 'client' };
    await expect(gate()).resolves.toBe('client_owner');
  });

  it.each(['service', 'agent', null, undefined])('rejects an owner of type %s (CE stub never approves)', async (userType) => {
    mocks.userRow = { is_inactive: false, user_type: userType };
    await expect(gate()).resolves.toBe('owner_type_rejected');
  });

  it('keeps the inactive and suspended-tenant gates', async () => {
    mocks.userRow = { is_inactive: true, user_type: 'internal' };
    await expect(gate()).resolves.toBe('user_inactive');
    mocks.userRow = { is_inactive: false, user_type: 'internal' };
    mocks.isTenantSuspended.mockResolvedValue(true);
    await expect(gate()).resolves.toBe('tenant_suspended');
  });
});
