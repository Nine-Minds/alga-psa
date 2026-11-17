import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig.ts';

/**
 * Microsoft calendar subscription renewal (alga-2026-0003322), DB-backed.
 *
 * Real: the maintenance fan-out and its tenant selector, CalendarWebhookMaintenanceService,
 * MicrosoftDeltaSyncService, CalendarProviderService and every table. Mocked: the Graph
 * boundary (MicrosoftCalendarAdapter) and CalendarSyncService (what a change does to
 * the schedule is covered by the sync service's own tests; here we assert which changes
 * reach it).
 */
wireLocalTestDbEnv();

const shared = vi.hoisted(() => ({
  db: null as Knex | null,
  /** Per-provider scripted Graph behaviour. */
  graph: {
    renew: new Map<string, () => Promise<void>>(),
    register: new Map<string, () => Promise<void>>(),
    delta: [] as Array<{ changes: Array<{ id: string; changeType: 'updated' | 'deleted' }>; deltaLink?: string; resetRequired?: boolean }>,
    calls: [] as string[],
    deltaArgs: [] as Array<string | null | undefined>,
  },
  sync: [] as Array<{ kind: 'sync' | 'delete'; externalEventId: string; providerId: string }>,
  handlerCalls: [] as Array<{ tenantId: string; lookAheadMinutes?: number }>,
}));

const db = () => shared.db as Knex;

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAdminConnection: async () => shared.db,
  createTenantKnex: async () => ({ knex: shared.db, tenant: 'unused' }),
  runWithTenant: async (_tenant: string, cb: () => Promise<unknown>) => cb(),
  isTenantSuspended: async () => false,
}));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => shared.db }));

vi.mock('@alga-psa/ee-calendar/lib/services/calendar/providers/MicrosoftCalendarAdapter', () => ({
  MicrosoftCalendarAdapter: class {
    constructor(private config: any) {}
    async connect() { shared.graph.calls.push(`connect:${this.config.id}`); }
    async renewWebhookSubscription() {
      shared.graph.calls.push(`renew:${this.config.id}`);
      const scripted = shared.graph.renew.get(this.config.id);
      if (scripted) return scripted();
      await shared.db!('microsoft_calendar_provider_config')
        .where({ calendar_provider_id: this.config.id })
        .update({ webhook_expires_at: new Date(Date.now() + 60 * 3600_000) });
    }
    async registerWebhookSubscription() {
      shared.graph.calls.push(`register:${this.config.id}`);
      const scripted = shared.graph.register.get(this.config.id);
      if (scripted) return scripted();
      await shared.db!('microsoft_calendar_provider_config')
        .where({ calendar_provider_id: this.config.id })
        .update({ webhook_subscription_id: `sub-${uuidv4()}`, webhook_expires_at: new Date(Date.now() + 60 * 3600_000) });
    }
    async fetchDeltaChanges(deltaLink?: string | null) {
      shared.graph.calls.push(`delta:${this.config.id}`);
      shared.graph.deltaArgs.push(deltaLink);
      return shared.graph.delta.shift() ?? { changes: [], deltaLink: deltaLink ?? undefined };
    }
  },
}));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarSyncService', () => ({
  CalendarSyncService: class {
    async syncExternalEventToSchedule(externalEventId: string, providerId: string) {
      shared.sync.push({ kind: 'sync', externalEventId, providerId });
      return { success: true };
    }
    async handleInboundExternalDelete(externalEventId: string, providerId: string) {
      shared.sync.push({ kind: 'delete', externalEventId, providerId });
      return { success: true };
    }
  },
}));
// The jobs package handler is the CE-safe delegator; the fan-out test drives the selector only.
vi.mock('@alga-psa/jobs/handlers/calendarWebhookMaintenanceHandler', () => ({
  renewMicrosoftCalendarWebhooks: async (data: { tenantId: string; lookAheadMinutes?: number }) => { shared.handlerCalls.push(data); },
  verifyGoogleCalendarProvisioning: async () => undefined,
}));

import { runMaintenanceJob } from '@alga-psa/jobs/fanout';
import { CalendarProviderService } from '@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService';
import { CalendarWebhookMaintenanceService } from '@alga-psa/ee-calendar/lib/services/calendar/CalendarWebhookMaintenanceService';

const HOUR = 3600_000;

describe('Microsoft calendar subscription renewal (DB-backed)', () => {
  const tenants = { a: uuidv4(), b: uuidv4(), c: uuidv4(), d: uuidv4(), renew: uuidv4() };

  async function seedTenant(tenant: string) {
    await db()('tenants').insert({ tenant, client_name: `Renewal ${tenant.slice(0, 6)}`, email: `${tenant.slice(0, 8)}@example.com`, created_at: new Date(), updated_at: new Date() });
  }

  async function seedProvider(
    tenant: string,
    opts: { type?: 'microsoft' | 'google'; active?: boolean; subscriptionId?: string | null; expiresAt?: Date | null; deltaLink?: string | null; failures?: number } = {},
  ) {
    const id = uuidv4();
    const type = opts.type ?? 'microsoft';
    await db()('calendar_providers').insert({
      id, tenant, provider_type: type, provider_name: `${type} ${id.slice(0, 6)}`, calendar_id: 'calendar',
      is_active: opts.active ?? true, status: 'connected', sync_direction: 'bidirectional', vendor_config: {},
    });
    if (type === 'microsoft') {
      await db()('microsoft_calendar_provider_config').insert({
        calendar_provider_id: id, tenant, client_id: 'client', client_secret: 'secret', tenant_id: 'common',
        redirect_uri: 'http://localhost/cb', calendar_id: 'calendar', access_token: 'at', refresh_token: 'rt',
        token_expires_at: new Date(Date.now() + HOUR),
        webhook_subscription_id: opts.subscriptionId === undefined ? 'old-sub' : opts.subscriptionId,
        webhook_expires_at: opts.expiresAt === undefined ? new Date(Date.now() + 30 * 60_000) : opts.expiresAt,
        delta_link: opts.deltaLink ?? null,
      });
    }
    if (opts.failures !== undefined) {
      await db()('calendar_provider_health').insert({ calendar_provider_id: id, tenant, consecutive_failure_count: opts.failures });
    }
    return id;
  }

  const health = (tenant: string, id: string) => db()('calendar_provider_health').where({ tenant, calendar_provider_id: id }).first();
  // delta_link is encrypted at rest, so read it back through the service that owns the codec.
  const storedDeltaLink = async (tenant: string, id: string) =>
    (await new CalendarProviderService().getProvider(id, tenant, { includeSecrets: true }))?.provider_config?.deltaLink;
  const config = (tenant: string, id: string) => db()('microsoft_calendar_provider_config').where({ tenant, calendar_provider_id: id }).first();

  beforeAll(async () => {
    shared.db = await createTestDbConnection();
    for (const tenant of Object.values(tenants)) await seedTenant(tenant);
  });

  afterAll(async () => {
    if (!shared.db) return;
    for (const tenant of Object.values(tenants)) {
      await db()('calendar_provider_health').where({ tenant }).del();
      await db()('microsoft_calendar_provider_config').where({ tenant }).del();
      await db()('calendar_providers').where({ tenant }).del();
      await db()('tenants').where({ tenant }).del();
    }
    await shared.db.destroy();
  });

  beforeEach(async () => {
    shared.graph.renew.clear();
    shared.graph.register.clear();
    shared.graph.delta.length = 0;
    shared.graph.calls.length = 0;
    shared.graph.deltaArgs.length = 0;
    shared.sync.length = 0;
    shared.handlerCalls.length = 0;
    for (const tenant of [tenants.renew]) {
      await db()('calendar_provider_health').where({ tenant }).del();
      await db()('microsoft_calendar_provider_config').where({ tenant }).del();
      await db()('calendar_providers').where({ tenant }).del();
    }
  });

  it('T002: the fan-out selects only tenants with an active Microsoft calendar provider', async () => {
    await seedProvider(tenants.a, { type: 'microsoft', active: true });
    await seedProvider(tenants.c, { type: 'google', active: true });
    await seedProvider(tenants.d, { type: 'microsoft', active: false });
    // tenants.b has no calendar provider at all.

    const result = await runMaintenanceJob('renew-microsoft-calendar-webhooks');

    const ours = new Set(Object.values(tenants));
    const ran = shared.handlerCalls.filter((call) => ours.has(call.tenantId)).map((call) => call.tenantId);
    expect(ran).toEqual([tenants.a]);
    expect(shared.handlerCalls.find((call) => call.tenantId === tenants.a)?.lookAheadMinutes).toBe(180);
    expect(result.failed).toBe(0);

    for (const tenant of [tenants.a, tenants.c, tenants.d]) {
      await db()('microsoft_calendar_provider_config').where({ tenant }).del();
      await db()('calendar_providers').where({ tenant }).del();
    }
  });

  it('T003: an expired subscription is recreated, health is written and the gap is caught up', async () => {
    const id = await seedProvider(tenants.renew, {
      subscriptionId: 'expired-sub', expiresAt: new Date(Date.now() - 24 * HOUR), deltaLink: 'https://graph/old-delta',
    });
    // Renewing an expired subscription is a Graph 404 ResourceNotFound.
    shared.graph.renew.set(id, async () => { throw Object.assign(new Error('Error in renewWebhookSubscription: Request failed (code: ResourceNotFound)'), { status: 404, code: 'ResourceNotFound' }); });
    shared.graph.delta.push({
      changes: [{ id: 'outlook-event-1', changeType: 'updated' }, { id: 'outlook-event-2', changeType: 'deleted' }],
      deltaLink: 'https://graph/new-delta',
    });

    const [result] = await new CalendarWebhookMaintenanceService().renewMicrosoftWebhooks({ tenantId: tenants.renew, lookAheadMinutes: 180 });

    expect(result).toMatchObject({ providerId: id, success: true, action: 'recreated', catchUp: { changesApplied: 2, changesFailed: 0 } });
    expect(shared.graph.calls).toContain(`register:${id}`);
    const row = await config(tenants.renew, id);
    expect(row.webhook_subscription_id).not.toBe('expired-sub');
    expect(new Date(row.webhook_expires_at).getTime()).toBeGreaterThan(Date.now() + 48 * HOUR);
    expect(await storedDeltaLink(tenants.renew, id)).toBe('https://graph/new-delta');
    expect(shared.graph.deltaArgs).toEqual(['https://graph/old-delta']);
    expect(shared.sync).toEqual([
      { kind: 'sync', externalEventId: 'outlook-event-1', providerId: id },
      { kind: 'delete', externalEventId: 'outlook-event-2', providerId: id },
    ]);
    expect(await health(tenants.renew, id)).toMatchObject({ subscription_status: 'healthy', last_renewal_result: 'success', consecutive_failure_count: 0 });
  });

  it('T003: a rejected stored deltaLink is reset and refetched during the catch-up', async () => {
    const id = await seedProvider(tenants.renew, { subscriptionId: null, expiresAt: null, deltaLink: 'https://graph/stale-delta' });
    shared.graph.delta.push({ changes: [], resetRequired: true });
    shared.graph.delta.push({ changes: [{ id: 'after-reset', changeType: 'updated' }], deltaLink: 'https://graph/fresh-delta' });

    const [result] = await new CalendarWebhookMaintenanceService().renewMicrosoftWebhooks({ tenantId: tenants.renew });

    expect(result).toMatchObject({ action: 'recreated', catchUp: { changesApplied: 1 } });
    expect(shared.graph.deltaArgs).toEqual(['https://graph/stale-delta', undefined]);
    expect(await storedDeltaLink(tenants.renew, id)).toBe('https://graph/fresh-delta');
    expect(shared.sync.map((s) => s.externalEventId)).toEqual(['after-reset']);
  });

  it('T004: an ordinary renewal extends the expiry and does not run a catch-up', async () => {
    const id = await seedProvider(tenants.renew, { subscriptionId: 'live-sub', expiresAt: new Date(Date.now() + 30 * 60_000) });
    shared.graph.delta.push({ changes: [{ id: 'must-not-sync', changeType: 'updated' }] });

    const [result] = await new CalendarWebhookMaintenanceService().renewMicrosoftWebhooks({ tenantId: tenants.renew, lookAheadMinutes: 180 });

    expect(result).toMatchObject({ providerId: id, success: true, action: 'renewed' });
    expect(result.catchUp).toBeUndefined();
    expect(shared.graph.calls).toEqual([`renew:${id}`]);
    expect(shared.sync).toEqual([]);
    expect(new Date((await config(tenants.renew, id)).webhook_expires_at).getTime()).toBeGreaterThan(Date.now() + 48 * HOUR);
    expect(await health(tenants.renew, id)).toMatchObject({ last_renewal_result: 'success' });
  });

  it('T004: a subscription outside the look-ahead window is not a candidate', async () => {
    await seedProvider(tenants.renew, { subscriptionId: 'live-sub', expiresAt: new Date(Date.now() + 40 * HOUR) });
    expect(await new CalendarWebhookMaintenanceService().renewMicrosoftWebhooks({ tenantId: tenants.renew, lookAheadMinutes: 180 })).toEqual([]);
  });

  it('T007: a token failure on one provider is recorded and the next provider is still renewed', async () => {
    const bad = await seedProvider(tenants.renew, { subscriptionId: 'bad-sub', failures: 2 });
    const good = await seedProvider(tenants.renew, { subscriptionId: 'good-sub' });
    // A revoked refresh token: not a 404, so it must not turn into a recreate.
    shared.graph.renew.set(bad, async () => { throw Object.assign(new Error('Error in refreshAccessToken: invalid_grant (404 in the message text)'), { status: 400, code: 'invalid_grant' }); });

    const results = await new CalendarWebhookMaintenanceService().renewMicrosoftWebhooks({ tenantId: tenants.renew, lookAheadMinutes: 180 });

    expect(results.find((r) => r.providerId === bad)).toMatchObject({ success: false, action: 'failed' });
    expect(results.find((r) => r.providerId === good)).toMatchObject({ success: true, action: 'renewed' });
    expect(shared.graph.calls).not.toContain(`register:${bad}`);
    expect(await health(tenants.renew, bad)).toMatchObject({ subscription_status: 'error', last_renewal_result: 'failure', consecutive_failure_count: 3 });
    expect(await db()('calendar_providers').where({ tenant: tenants.renew, id: bad }).first()).toMatchObject({ status: 'error' });
    expect(await health(tenants.renew, good)).toMatchObject({ last_renewal_result: 'success' });
    expect(await db()('calendar_providers').where({ tenant: tenants.renew, id: good }).first()).toMatchObject({ status: 'connected' });
  });

  it('a catch-up failure keeps the recreate and leaves the stored deltaLink alone', async () => {
    const id = await seedProvider(tenants.renew, { subscriptionId: null, expiresAt: null, deltaLink: 'https://graph/keep-me' });
    shared.graph.delta.length = 0;
    const originalShift = shared.graph.delta.shift.bind(shared.graph.delta);
    shared.graph.delta.shift = () => { throw new Error('Graph unavailable'); };
    try {
      const [result] = await new CalendarWebhookMaintenanceService().renewMicrosoftWebhooks({ tenantId: tenants.renew });
      expect(result).toMatchObject({ success: true, action: 'recreated', catchUp: { changesApplied: 0, error: 'Graph unavailable' } });
    } finally {
      shared.graph.delta.shift = originalShift;
    }
    expect(await storedDeltaLink(tenants.renew, id)).toBe('https://graph/keep-me');
  });

  it('the schema refuses a second mapping for one external event, so a notification racing a maintenance sync cannot duplicate an entry', async () => {
    // Both paths apply a change through CalendarSyncService.syncExternalEventToSchedule, which creates the
    // schedule entry and its mapping in one transaction; the unique index makes the loser of a race roll
    // back (entry included) and retry as an update.
    const id = await seedProvider(tenants.renew);
    const mapping = (entry: string) => ({
      id: uuidv4(), tenant: tenants.renew, calendar_provider_id: id, schedule_entry_id: entry, external_event_id: 'outlook-event-race',
    });
    await db()('calendar_event_mappings').insert(mapping(uuidv4()));
    await expect(db()('calendar_event_mappings').insert(mapping(uuidv4()))).rejects.toThrow(/unique|duplicate/i);
    await db()('calendar_event_mappings').where({ tenant: tenants.renew }).del();
  });
});
