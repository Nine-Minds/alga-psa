import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * DO-NOT-PORT #25: the reference `cancel-tracking` endpoint had no `time_entry`
 * RBAC check. It must require `time_entry:update` (like stop-tracking) and must
 * not reach the service when the permission is missing.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';

const state = vi.hoisted(() => ({
  perms: {} as Record<string, boolean>,
  cancelled: [] as string[],
  checked: [] as string[],
}));

vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: vi.fn(async () => 'psa'),
  ProductAccessError: class ProductAccessError extends Error {},
}));
vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async (_u: unknown, resource: string, action: string) => {
    state.checked.push(`${resource}:${action}`);
    return !!state.perms[`${resource}:${action}`];
  }),
}));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@/lib/db', () => ({ runWithTenant: async (_t: string, fn: () => unknown) => fn() }));
vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async () => ({ user_id: ME, tenant: TENANT })),
    validateApiKeyForTenant: vi.fn(async () => ({ user_id: ME, tenant: TENANT })),
  },
}));
vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async () => ({ user_id: ME, tenant: TENANT, user_type: 'internal' })),
}));
vi.mock('@/lib/api/services/TimeEntryService', () => ({
  TimeEntryService: class {
    async cancelTimeTracking(sessionId: string) {
      state.cancelled.push(sessionId);
      return { session_id: sessionId, status: 'discarded' };
    }
  },
}));

const { ApiTimeEntryController } = await import('@/lib/api/controllers/ApiTimeEntryController');

const req = () =>
  new NextRequest(`http://localhost/api/v1/time-entries/cancel-tracking/${SESSION}`, {
    method: 'POST',
    headers: { 'x-api-key': 'k' },
  });

beforeEach(() => {
  state.perms = {};
  state.cancelled = [];
  state.checked = [];
});

describe('POST /api/v1/time-entries/cancel-tracking/{sessionId}', () => {
  it('is denied (403) without time_entry:update and never reaches the service', async () => {
    state.perms = { 'time_entry:read': true, 'time_entry:create': true };
    const res = await new ApiTimeEntryController().cancelTracking()(req());
    expect(res.status).toBe(403);
    expect(state.checked).toContain('time_entry:update');
    expect(state.cancelled).toEqual([]);
  });

  it('cancels the identified session with time_entry:update', async () => {
    state.perms = { 'time_entry:update': true };
    const res = await new ApiTimeEntryController().cancelTracking()(req());
    expect(res.status).toBe(200);
    expect(state.cancelled).toEqual([SESSION]);
  });

  it('rejects a missing API key with 401', async () => {
    const res = await new ApiTimeEntryController().cancelTracking()(
      new NextRequest(`http://localhost/api/v1/time-entries/cancel-tracking/${SESSION}`, { method: 'POST' }),
    );
    expect(res.status).toBe(401);
    expect(state.cancelled).toEqual([]);
  });
});
