import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../../test-utils/dbConfig.ts';
import { tenantDb } from '@alga-psa/db';
import { CalendarProviderService as EeCalendarProviderService } from '@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService';
import { CalendarProviderService as IntegrationsCalendarProviderService } from '@alga-psa/integrations/services/calendar/CalendarProviderService';
import { CalendarProviderService as ServerCalendarProviderService } from '../../../services/calendar/CalendarProviderService';

// alga-2026-0002699: getProviders must run one query regardless of provider count and must not
// load vendor config (it is discarded: list results always carry provider_config: undefined).

const fixture = vi.hoisted(() => ({
  db: null as Knex | null,
  tenant: '',
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: fixture.db, tenant: fixture.tenant }),
}));

vi.mock('../../../lib/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../lib/db')>(),
  createTenantKnex: async () => ({ knex: fixture.db, tenant: fixture.tenant }),
}));

const copies = [
  ['ee/packages/calendar', EeCalendarProviderService],
  ['packages/integrations', IntegrationsCalendarProviderService],
  ['server/src', ServerCalendarProviderService],
] as const;

describe('CalendarProviderService.getProviders query count', () => {
  const tenant = uuidv4();
  const otherTenant = uuidv4();
  const userA = uuidv4();
  const userB = uuidv4();
  const userC = uuidv4();
  const userD = uuidv4();
  const otherUser = uuidv4();
  let db: Knex;

  // Unique per (tenant, user_id, provider_type), so each google provider has its own user.
  // Oldest first; getProviders orders by created_at desc.
  const seeded: Array<{ id: string; type: 'google' | 'microsoft'; user: string; calendarId: string; active: boolean; hasConfig: boolean; name: string }> = [];
  const otherTenantProviderId = uuidv4();

  async function seedUser(t: string, userId: string) {
    await tenantDb(db, t).table('users').insert({
      tenant: t,
      user_id: userId,
      username: `gp-${userId.slice(0, 8)}`,
      email: `${userId}@example.test`,
      user_type: 'internal',
      hashed_password: 'not-used',
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  async function seedProvider(t: string, p: { id: string; type: 'google' | 'microsoft'; user: string; calendarId: string; active: boolean; hasConfig: boolean; name: string }, createdAt: Date) {
    await tenantDb(db, t).table('calendar_providers').insert({
      id: p.id,
      tenant: t,
      user_id: p.user,
      provider_type: p.type,
      provider_name: p.name,
      calendar_id: p.calendarId,
      is_active: p.active,
      sync_direction: p.type === 'google' ? 'bidirectional' : 'to_external',
      status: 'connected',
      vendor_config: {},
      created_at: createdAt,
      updated_at: createdAt,
    });
    if (!p.hasConfig) return;
    if (p.type === 'google') {
      await tenantDb(db, t).table('google_calendar_provider_config').insert({
        calendar_provider_id: p.id,
        tenant: t,
        client_id: `client-${p.name}`,
        client_secret: 'google-client-secret',
        project_id: 'project-1',
        redirect_uri: 'https://example.test/google/callback',
        calendar_id: p.calendarId,
        access_token: 'google-access-token',
        refresh_token: 'google-refresh-token',
      });
    } else {
      await tenantDb(db, t).table('microsoft_calendar_provider_config').insert({
        calendar_provider_id: p.id,
        tenant: t,
        client_id: `client-${p.name}`,
        client_secret: 'ms-client-secret',
        tenant_id: 'ms-tenant',
        redirect_uri: 'https://example.test/ms/callback',
        calendar_id: p.calendarId,
        access_token: 'ms-access-token',
        refresh_token: 'ms-refresh-token',
      });
    }
  }

  beforeAll(async () => {
    db = await createTestDbConnection({ recreate: false });
    fixture.db = db;
    fixture.tenant = tenant;

    for (const t of [tenant, otherTenant]) {
      await db('tenants').insert({ tenant: t, client_name: `GetProviders Test ${t.slice(0, 6)}`, email: `${t}@example.test`, created_at: new Date(), updated_at: new Date() }).onConflict('tenant').ignore();
    }
    await seedUser(tenant, userA);
    await seedUser(tenant, userB);
    await seedUser(tenant, userC);
    await seedUser(tenant, userD);
    await seedUser(otherTenant, otherUser);

    const specs: Array<[string, 'google' | 'microsoft', string, string, boolean, boolean]> = [
      ['g1', 'google', userA, 'cal-1', true, true],
      ['g2', 'google', userB, 'cal-2', false, true],
      ['g3', 'google', userC, 'cal-3', true, true],
      ['m1', 'microsoft', userA, 'cal-4', true, true],
      ['m2', 'microsoft', userB, 'cal-5', true, true],
      ['g-noconfig', 'google', userD, 'cal-6', true, false],
    ];
    const base = Date.parse('2026-01-01T00:00:00Z');
    for (const [i, [name, type, user, calendarId, active, hasConfig]] of specs.entries()) {
      const p = { id: uuidv4(), type, user, calendarId, active, hasConfig, name };
      seeded.push(p);
      await seedProvider(tenant, p, new Date(base + i * 60_000));
    }
    await seedProvider(otherTenant, { id: otherTenantProviderId, type: 'google', user: otherUser, calendarId: 'cal-other', active: true, hasConfig: true, name: 'other-tenant' }, new Date(base + 10 * 60_000));
  });

  afterAll(async () => {
    for (const t of [tenant, otherTenant]) {
      await tenantDb(db, t).table('google_calendar_provider_config').del();
      await tenantDb(db, t).table('microsoft_calendar_provider_config').del();
      await tenantDb(db, t).table('calendar_providers').del();
      await tenantDb(db, t).table('users').del();
      await tenantDb(db, t).unscoped('tenants', 'remove isolated getProviders query count test tenant').where({ tenant: t }).del();
    }
    await db.destroy();
  });

  async function captureQueries<T>(fn: () => Promise<T>): Promise<{ result: T; sql: string[] }> {
    const sql: string[] = [];
    const listener = (q: { sql: string }) => sql.push(q.sql);
    db.on('query', listener);
    try {
      return { result: await fn(), sql };
    } finally {
      db.removeListener('query', listener);
    }
  }

  describe.each(copies)('%s copy', (_label, ServiceClass) => {
    const service = () => new ServiceClass();

    it('runs exactly one query and never touches the vendor config tables', async () => {
      const { result, sql } = await captureQueries(() => service().getProviders({ tenant }));

      expect(result).toHaveLength(6);
      expect(sql).toHaveLength(1);
      expect(sql[0]).toContain('calendar_providers');
      expect(sql.join('\n')).not.toMatch(/_calendar_provider_config/);
    });

    it('returns tenant-scoped summaries ordered by created_at desc with provider_config undefined', async () => {
      const result = await service().getProviders({ tenant });

      expect(result.map((r) => r.id)).toEqual([...seeded].reverse().map((p) => p.id));
      expect(result.map((r) => r.id)).not.toContain(otherTenantProviderId);
      for (const row of result) {
        const expected = seeded.find((p) => p.id === row.id)!;
        expect(row.provider_config).toBeUndefined();
        expect(row).toMatchObject({
          tenant,
          user_id: expected.user,
          name: expected.name,
          provider_type: expected.type,
          calendar_id: expected.calendarId,
          active: expected.active,
          sync_direction: expected.type === 'google' ? 'bidirectional' : 'to_external',
          connection_status: 'connected',
        });
        expect(row.created_at).toBeDefined();
        expect(row.updated_at).toBeDefined();
      }
    });

    it('still narrows by userId, providerType, isActive and calendarId', async () => {
      const ids = async (filters: Record<string, unknown>) =>
        (await service().getProviders({ tenant, ...filters } as any)).map((r) => r.name).sort();

      expect(await ids({ userId: userA })).toEqual(['g1', 'm1']);
      expect(await ids({ providerType: 'microsoft' })).toEqual(['m1', 'm2']);
      expect(await ids({ isActive: false })).toEqual(['g2']);
      expect(await ids({ calendarId: 'cal-3' })).toEqual(['g3']);
      expect(await ids({ userId: userB, providerType: 'microsoft', isActive: true })).toEqual(['m2']);
    });

    it('does not leak other tenants', async () => {
      const result = await service().getProviders({ tenant: otherTenant });
      expect(result.map((r) => r.id)).toEqual([otherTenantProviderId]);
    });

    it('getProvider with includeSecrets still returns the vendor config', async () => {
      const google = seeded.find((p) => p.name === 'g1')!;
      const microsoft = seeded.find((p) => p.name === 'm1')!;

      const g = await service().getProvider(google.id, tenant, { includeSecrets: true });
      expect(g?.provider_config).toMatchObject({
        clientId: 'client-g1',
        clientSecret: 'google-client-secret',
        accessToken: 'google-access-token',
        refreshToken: 'google-refresh-token',
        projectId: 'project-1',
      });

      const m = await service().getProvider(microsoft.id, tenant, { includeSecrets: true });
      expect(m?.provider_config).toMatchObject({
        clientId: 'client-m1',
        clientSecret: 'ms-client-secret',
        accessToken: 'ms-access-token',
        refreshToken: 'ms-refresh-token',
        tenantId: 'ms-tenant',
      });

      const withoutSecrets = await service().getProvider(google.id, tenant, { includeSecrets: false });
      expect(withoutSecrets?.provider_config).toBeUndefined();
    });
  });
});
