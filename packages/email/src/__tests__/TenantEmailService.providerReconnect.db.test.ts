import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeKnex, tenantDbMock } from './helpers/fakeKnex';

// Only the Graph send boundary is stubbed; EmailProviderManager's real Microsoft
// readiness check (status / is_active on email_providers) decides connectedness.
const graph = vi.hoisted(() => ({ inits: 0, inFlight: 0, maxInFlight: 0, sent: [] as any[] }));
const db = vi.hoisted(() => ({ knex: null as any, queries: [] as Array<{ table: string; tenant?: unknown }> }));

vi.mock('@alga-psa/core/logger', () => ({
  default: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@alga-psa/core/rateLimit', () => ({
  TokenBucketRateLimiter: { getInstance: () => ({ isReady: () => false }) },
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({}));
vi.mock('../features', () => ({ isEnterprise: false }));
vi.mock('../system/SystemEmailProviderFactory', () => ({
  SystemEmailProviderFactory: { createProvider: vi.fn(async () => null), getConfigFingerprint: () => 'system' },
}));
vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => db.knex),
  isTenantSuspended: vi.fn(async () => false),
  tenantDb: (conn: any, tenant: string) => {
    const scoped = tenantDbMock(conn, tenant);
    return { table: (table: string) => { db.queries.push({ table, tenant }); return scoped.table(table); } };
  },
}));
vi.mock('../senderIdentity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../senderIdentity')>()),
  resolveTenantCompanyName: vi.fn(async () => 'Example MSP'),
}));
vi.mock('@alga-psa/shared/services/email/microsoftEmailProviderConfig', () => ({
  buildMicrosoftEmailProviderConfig: vi.fn(async (input: any) => ({ id: input.id, mailbox: input.mailbox })),
}));
vi.mock('../providers/MicrosoftGraphEmailProvider', () => ({
  MicrosoftGraphEmailProvider: class {
    providerType = 'microsoft';
    capabilities = {};
    constructor(public providerId: string) {}
    async initialize() { graph.inits += 1; }
    async sendEmail(message: any) {
      graph.inFlight += 1;
      graph.maxInFlight = Math.max(graph.maxInFlight, graph.inFlight);
      graph.sent.push(message);
      graph.inFlight -= 1;
      return { success: true, messageId: `graph-${graph.sent.length}`, providerId: this.providerId, providerType: 'microsoft', sentAt: new Date() };
    }
  },
}));

import { FAILED_PROVIDER_RETRY_MS, TenantEmailService } from '../TenantEmailService';

const SETTINGS_UPDATED_AT = '2026-08-04T12:00:00.000Z';

function tenantTables(tenant: string, mailbox: { status: string; is_active: boolean; updated_at: string }) {
  const providerId = `mailbox-${tenant}`;
  return {
    tenant_email_settings: [{
      tenant,
      default_from_domain: 'example.test',
      ticketing_from_email: null,
      ticketing_from_name: null,
      custom_domains: [],
      email_provider: 'microsoft',
      provider_configs: [{
        providerId: `cfg-${tenant}`,
        providerType: 'microsoft',
        isEnabled: true,
        config: { inboundProviderId: providerId, from: 'support@example.test' },
      }],
      tracking_enabled: false,
      created_at: SETTINGS_UPDATED_AT,
      updated_at: SETTINGS_UPDATED_AT,
    }],
    email_providers: [{ id: providerId, tenant, provider_type: 'microsoft', mailbox: 'support@example.test', ...mailbox }],
    microsoft_email_provider_config: [{ email_provider_id: providerId, tenant }],
    email_sender_addresses: [],
    email_sender_routes: [],
  };
}

const DOWN = { status: 'error', is_active: false, updated_at: '2026-08-04T12:00:00.000Z' };
const UP = { status: 'connected', is_active: true, updated_at: '2026-08-04T12:05:00.000Z' };

const send = (tenantId: string) => TenantEmailService.getInstance(tenantId).sendEmail({
  tenantId,
  mailClass: 'ticket',
  to: 'client@example.test',
  subject: 'Ticket received',
  html: '<p>Acknowledged</p>',
} as any);

function reconnect(tables: any, tenant: string, mailbox = UP) {
  Object.assign(tables.email_providers.find((row: any) => row.tenant === tenant), mailbox);
}

describe('TenantEmailService Microsoft mailbox reconnect', () => {
  let tables: any;
  const tenantA = 'tenant-reconnect-a';
  const tenantB = 'tenant-reconnect-b';

  beforeEach(async () => {
    vi.useFakeTimers();
    graph.inits = 0; graph.inFlight = 0; graph.maxInFlight = 0; graph.sent.length = 0;
    db.queries.length = 0;
    const a = tenantTables(tenantA, DOWN);
    const b = tenantTables(tenantB, DOWN);
    tables = Object.fromEntries(Object.keys(a).map((key) => [key, [...(a as any)[key], ...(b as any)[key]]]));
    db.knex = createFakeKnex(tables);
    await TenantEmailService.invalidateTenantSettings(tenantA);
    await TenantEmailService.invalidateTenantSettings(tenantB);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-initializes after the mailbox reconnects even though tenant settings are untouched', async () => {
    const first = await send(tenantA);
    expect(first.success).toBe(false);
    expect(first.error).toMatch(/selected Microsoft mailbox is not connected/);
    expect(graph.sent).toHaveLength(0);

    reconnect(tables, tenantA);
    expect(tables.tenant_email_settings[0].updated_at).toBe(SETTINGS_UPDATED_AT);

    await expect(send(tenantA)).resolves.toMatchObject({ success: true });
    expect(graph.sent).toHaveLength(1);
  });

  it('keeps failing while the mailbox stays disconnected', async () => {
    await send(tenantA);
    vi.advanceTimersByTime(FAILED_PROVIDER_RETRY_MS + 1);
    const retry = await send(tenantA);
    expect(retry.success).toBe(false);
    expect(retry.error).toMatch(/not connected/);
    expect(graph.sent).toHaveLength(0);
  });

  it('retries after the window when the repair does not touch email_providers', async () => {
    // Connected row but no OAuth config yet: the fingerprint cannot change when it is added.
    reconnect(tables, tenantA);
    const vendorRows = tables.microsoft_email_provider_config.splice(0);
    const first = await send(tenantA);
    expect(first.error).toMatch(/no OAuth configuration/);

    tables.microsoft_email_provider_config.push(...vendorRows);
    await expect(send(tenantA)).resolves.toMatchObject({ success: false }); // cached inside the window
    vi.advanceTimersByTime(FAILED_PROVIDER_RETRY_MS + 1);
    await expect(send(tenantA)).resolves.toMatchObject({ success: true });
    expect(graph.sent).toHaveLength(1);
  });

  it('reuses a healthy provider across sends', async () => {
    reconnect(tables, tenantA);
    await send(tenantA);
    await send(tenantA);
    expect(graph.inits).toBe(1);
    expect(graph.sent).toHaveLength(2);
  });

  it('bounds re-initialization while the mailbox stays broken, including concurrent sends', async () => {
    reconnect(tables, tenantA);
    const vendorRows = tables.microsoft_email_provider_config.splice(0);
    // Each init attempt reads the vendor config once.
    const attempts = () => db.queries.filter((q) => q.table === 'microsoft_email_provider_config').length;

    await send(tenantA);
    expect(attempts()).toBe(1);
    await Promise.all([send(tenantA), send(tenantA), send(tenantA), send(tenantA)]);
    await send(tenantA);
    expect(attempts()).toBe(1); // inside the window: cached error, no re-init

    vi.advanceTimersByTime(FAILED_PROVIDER_RETRY_MS + 1);
    const failures = await Promise.all([send(tenantA), send(tenantA), send(tenantA)]);
    expect(failures.every((r) => !r.success)).toBe(true);
    expect(attempts()).toBe(2); // one retry for the whole burst
    expect(graph.sent).toHaveLength(0);
    tables.microsoft_email_provider_config.push(...vendorRows);
  });

  it.each([
    ['disconnected and inactive', { status: 'error', is_active: false }],
    ['inactive with status connected', { status: 'connected', is_active: false }],
    ['status error while active', { status: 'error', is_active: true }],
  ])('keeps sending through a healthy cached provider after the mailbox row is marked %s', async (_name, change) => {
    reconnect(tables, tenantA);
    await expect(send(tenantA)).resolves.toMatchObject({ success: true });
    expect(graph.sent).toHaveLength(1);
    expect(graph.inits).toBe(1);

    reconnect(tables, tenantA, { ...change, updated_at: '2026-08-04T12:10:00.000Z' } as any);
    expect(tables.tenant_email_settings[0].updated_at).toBe(SETTINGS_UPDATED_AT);

    await expect(send(tenantA)).resolves.toMatchObject({ success: true });
    expect(graph.sent).toHaveLength(2);
    expect(graph.inits).toBe(1); // same provider reused
  });

  it('recovers on a mailbox-only reconnect when init failed after a healthy period', async () => {
    reconnect(tables, tenantA);
    await expect(send(tenantA)).resolves.toMatchObject({ success: true });
    expect(graph.sent).toHaveLength(1);

    // A settings save forces re-init while the mailbox is down.
    reconnect(tables, tenantA, { ...DOWN, updated_at: '2026-08-04T12:10:00.000Z' });
    tables.tenant_email_settings[0].updated_at = '2026-08-04T12:11:00.000Z';
    const failed = await send(tenantA);
    expect(failed.success).toBe(false);
    expect(failed.error).toMatch(/not connected/);
    expect(graph.sent).toHaveLength(1);

    reconnect(tables, tenantA, { ...UP, updated_at: '2026-08-04T12:15:00.000Z' });
    await expect(send(tenantA)).resolves.toMatchObject({ success: true });
    expect(graph.sent).toHaveLength(2); // exactly one submission, no retry-window wait
  });

  it('runs a single init for concurrent sends after the mailbox reconnects', async () => {
    await send(tenantA);
    reconnect(tables, tenantA);
    const results = await Promise.all([send(tenantA), send(tenantA), send(tenantA)]);
    expect(results.every((r) => r.success)).toBe(true);
    expect(graph.inits).toBe(1);
  });

  it('isolates tenants and scopes every mailbox query by tenant', async () => {
    await send(tenantA);
    await send(tenantB);
    reconnect(tables, tenantA);

    await expect(send(tenantA)).resolves.toMatchObject({ success: true });
    const stillDown = await send(tenantB);
    expect(stillDown.success).toBe(false);
    expect(stillDown.error).toMatch(/not connected/);
    expect(graph.sent).toHaveLength(1);

    const mailboxQueries = db.queries.filter((q) => q.table === 'email_providers');
    expect(mailboxQueries.length).toBeGreaterThan(0);
    expect(mailboxQueries.every((q) => q.tenant === tenantA || q.tenant === tenantB)).toBe(true);
  });
});
