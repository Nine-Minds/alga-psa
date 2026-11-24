import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  fetches: [] as Array<{ deltaLink?: string | null }>,
  results: [] as any[],
  updates: [] as any[],
  applied: [] as Array<{ kind: string; id: string }>,
  failIds: new Set<string>(),
}));

vi.mock('@alga-psa/db', () => ({
  runWithTenant: async (_tenant: string, cb: () => Promise<unknown>) => cb(),
  createTenantKnex: async () => ({ knex: {}, tenant: 't1' }),
  isTenantSuspended: async () => false,
  tenantDb: () => ({}),
}));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => ({}) }));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/providers/MicrosoftCalendarAdapter', () => ({
  MicrosoftCalendarAdapter: class {
    async connect() {}
    async fetchDeltaChanges(deltaLink?: string | null) {
      state.fetches.push({ deltaLink });
      return state.results.shift();
    }
  },
}));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/providers/GoogleCalendarAdapter', () => ({ GoogleCalendarAdapter: class {} }));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService', () => ({
  CalendarProviderService: class {
    async updateProvider(id: string, tenant: string, data: unknown) { state.updates.push({ id, tenant, data }); }
  },
}));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarSyncService', () => ({
  CalendarSyncService: class {
    async syncExternalEventToSchedule(id: string) {
      state.applied.push({ kind: 'sync', id });
      return state.failIds.has(id) ? { success: false, error: 'nope' } : { success: true };
    }
    async handleInboundExternalDelete(id: string) {
      state.applied.push({ kind: 'delete', id });
      return { success: true };
    }
  },
}));

import { MicrosoftDeltaSyncService } from '@alga-psa/ee-calendar/lib/services/calendar/MicrosoftDeltaSyncService';
import { CalendarWebhookProcessor } from '@alga-psa/ee-calendar/lib/services/calendar/CalendarWebhookProcessor';
import { isResourceNotFoundError } from '@alga-psa/ee-calendar/lib/services/calendar/CalendarWebhookMaintenanceService';

const provider = (deltaLink: string | null = 'https://graph/stored') => ({
  id: 'p1', tenant: 't1', provider_type: 'microsoft', sync_direction: 'bidirectional',
  provider_config: { deltaLink, webhookVerificationToken: 'verify' },
}) as any;

beforeEach(() => {
  state.fetches.length = 0;
  state.results.length = 0;
  state.updates.length = 0;
  state.applied.length = 0;
  state.failIds.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('T005: MicrosoftDeltaSyncService', () => {
  it('fetches from the stored deltaLink, persists the new one and applies the changes', async () => {
    state.results.push({ changes: [{ id: 'e1', changeType: 'updated' }, { id: 'e2', changeType: 'deleted' }], deltaLink: 'https://graph/next' });
    const result = await new MicrosoftDeltaSyncService().syncProviderDelta(provider());
    expect(state.fetches).toEqual([{ deltaLink: 'https://graph/stored' }]);
    expect(state.updates).toEqual([{ id: 'p1', tenant: 't1', data: { vendorConfig: { deltaLink: 'https://graph/next' } } }]);
    expect(state.applied).toEqual([{ kind: 'sync', id: 'e1' }, { kind: 'delete', id: 'e2' }]);
    expect(result).toEqual({ success: 2, failed: 0 });
  });

  it('resets and refetches when Graph rejects the stored deltaLink, then saves the new link', async () => {
    state.results.push({ changes: [], resetRequired: true });
    state.results.push({ changes: [{ id: 'e1', changeType: 'updated' }], deltaLink: 'https://graph/fresh' });
    const result = await new MicrosoftDeltaSyncService().syncProviderDelta(provider());
    expect(state.fetches).toEqual([{ deltaLink: 'https://graph/stored' }, { deltaLink: undefined }]);
    expect(state.updates.map((u) => u.data)).toEqual([
      { vendorConfig: { deltaLink: null } },
      { vendorConfig: { deltaLink: 'https://graph/fresh' } },
    ]);
    expect(result).toEqual({ success: 1, failed: 0 });
  });

  it('does not rewrite an unchanged deltaLink, de-duplicates changes and counts failures', async () => {
    state.failIds.add('bad');
    state.results.push({ changes: [{ id: 'e1', changeType: 'updated' }, { id: 'bad', changeType: 'updated' }], deltaLink: 'https://graph/stored' });
    const result = await new MicrosoftDeltaSyncService().syncProviderDelta(provider(), {
      additionalChanges: [{ id: 'e1', changeType: 'updated' }, { id: 'e3', changeType: 'updated' }],
    });
    expect(state.updates).toEqual([]);
    expect(state.applied.filter((a) => a.id === 'e1')).toHaveLength(1);
    expect(result.success).toBe(2);
    expect(result.failed).toBe(1);
  }, 10_000);

  it('processMicrosoftWebhook delegates to it, merging notification changes, and keeps its result shape', async () => {
    state.results.push({ changes: [{ id: 'from-delta', changeType: 'updated' }], deltaLink: 'https://graph/next' });
    const processor = new CalendarWebhookProcessor();
    vi.spyOn(processor as any, 'getProviderByMicrosoftSubscription').mockResolvedValue(provider());
    const outcome = await processor.processMicrosoftWebhook([
      { subscriptionId: 's1', changeType: 'deleted', clientState: 'verify', resourceData: { id: 'from-notification' } },
    ]);
    expect(outcome).toEqual({ success: 2, failed: 0 });
    expect(state.applied).toEqual([{ kind: 'sync', id: 'from-delta' }, { kind: 'delete', id: 'from-notification' }]);
  });
});

describe('T006: isResourceNotFoundError', () => {
  it('is true for an HTTP 404 or the Graph ResourceNotFound code', () => {
    expect(isResourceNotFoundError({ status: 404 })).toBe(true);
    expect(isResourceNotFoundError({ response: { status: 404 } })).toBe(true);
    expect(isResourceNotFoundError({ code: 'ResourceNotFound' })).toBe(true);
    expect(isResourceNotFoundError({ response: { status: 400, data: { error: { code: 'ResourceNotFound' } } } })).toBe(true);
    expect(isResourceNotFoundError({ responseBody: { error: { code: 'ResourceNotFound' } } })).toBe(true);
  });

  it('is false for unrelated errors, including a message that merely contains 404', () => {
    expect(isResourceNotFoundError(new Error('Error in renewWebhookSubscription: tenant 4041 timed out (code: 404x)'))).toBe(false);
    expect(isResourceNotFoundError(new Error('Subscription not found'))).toBe(false);
    expect(isResourceNotFoundError({ status: 400, code: 'invalid_grant', message: 'refresh token for 404' })).toBe(false);
    expect(isResourceNotFoundError({ status: 401 })).toBe(false);
    expect(isResourceNotFoundError(undefined)).toBe(false);
  });
});
