import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../../test-utils/dbConfig.ts';
import { tenantDb } from '@alga-psa/db';
import { CalendarProviderService } from '@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService';

// alga-2026-0002702: provider + vendor-config writes must commit or roll back together.
// createTenantKnex returns the pool handle (not a wrapping trx) so rollbacks are observable.
const fixture = vi.hoisted(() => ({ db: null as Knex | null, tenant: '' }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: fixture.db, tenant: fixture.tenant }),
}));

describe('CalendarProviderService transactional writes', () => {
  const tenant = uuidv4();
  const userId = uuidv4();
  let db: Knex;
  let service: CalendarProviderService;

  const scoped = (table: string) => tenantDb(db, tenant).table(table);

  const microsoftConfig = (overrides: Record<string, unknown> = {}) => ({
    clientId: 'ms-client-id',
    clientSecret: 'ms-client-secret',
    tenantId: 'ms-tenant-id',
    redirectUri: 'https://example.com/oauth/microsoft',
    calendarId: 'primary',
    ...overrides,
  });

  const baseData = (providerType: 'google' | 'microsoft', providerName: string, vendorConfig: any) => ({
    tenant,
    userId,
    providerType,
    providerName,
    calendarId: 'primary',
    isActive: true,
    syncDirection: 'bidirectional' as const,
    vendorConfig,
  });

  const count = async (table: string) => Number((await scoped(table).count<{ count: string }[]>('* as count'))[0].count);

  async function clearProviders() {
    await scoped('calendar_event_mappings').del();
    await scoped('google_calendar_provider_config').del();
    await scoped('microsoft_calendar_provider_config').del();
    await scoped('calendar_providers').del();
  }

  beforeAll(async () => {
    process.env.CALENDAR_OAUTH_ENCRYPTION_KEY = 'integration-test-calendar-key';
    db = await createTestDbConnection({ recreate: false });
    fixture.db = db;
    fixture.tenant = tenant;
    await db('tenants').insert({ tenant, client_name: 'Calendar Provider Tx Test', email: `${tenant}@example.test`, created_at: new Date(), updated_at: new Date() }).onConflict('tenant').ignore();
    await scoped('users').insert({
      tenant,
      user_id: userId,
      username: `calendar-${userId.slice(0, 6)}`,
      email: `${userId}@example.test`,
      user_type: 'internal',
      hashed_password: 'not-used',
      created_at: new Date(),
      updated_at: new Date(),
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearProviders();
  });

  afterAll(async () => {
    await clearProviders();
    await scoped('users').del();
    await tenantDb(db, tenant).unscoped('tenants', 'remove isolated calendar provider transaction test tenant').where({ tenant }).del();
    await db.destroy();
  });

  it('leaves no provider row when vendor config encryption fails', async () => {
    service = new CalendarProviderService();
    vi.spyOn(service as any, 'encryptVendorConfig').mockRejectedValue(new Error('encryption key unavailable'));

    await expect(service.createProvider(baseData('microsoft', 'Enc fail', microsoftConfig())))
      .rejects.toThrow(/Failed to create calendar provider: encryption key unavailable/);

    expect(await count('calendar_providers')).toBe(0);
  });

  it('rolls back the provider row when the vendor insert fails', async () => {
    service = new CalendarProviderService();

    await expect(service.createProvider(baseData('microsoft', 'Insert fail', microsoftConfig({ tokenExpiresAt: 'not-a-timestamp' }))))
      .rejects.toThrow(/Failed to create calendar provider: .*(timestamp|date\/time)/i);

    expect(await count('calendar_providers')).toBe(0);
    expect(await count('microsoft_calendar_provider_config')).toBe(0);
  });

  it.each(['google', 'microsoft'] as const)('creates one provider row and one vendor row for %s', async (providerType) => {
    service = new CalendarProviderService();
    const vendorConfig = providerType === 'google'
      ? { clientId: 'g-client', clientSecret: 'g-secret', projectId: 'g-project', redirectUri: 'https://example.com/oauth/google', calendarId: 'primary' }
      : microsoftConfig();

    const created = await service.createProvider(baseData(providerType, `Happy ${providerType}`, vendorConfig));

    expect(created).toMatchObject({
      tenant,
      user_id: userId,
      name: `Happy ${providerType}`,
      provider_type: providerType,
      calendar_id: 'primary',
      active: true,
      sync_direction: 'bidirectional',
    });
    expect(created.provider_config).toBeUndefined();
    expect(await count('calendar_providers')).toBe(1);
    expect(await count(`${providerType}_calendar_provider_config`)).toBe(1);
  });

  it('rolls back the main update when updateProvider is missing required credentials', async () => {
    service = new CalendarProviderService();
    const created = await service.createProvider(baseData('microsoft', 'Original name', undefined));
    expect(await count('microsoft_calendar_provider_config')).toBe(0);

    await expect(service.updateProvider(created.id, tenant, {
      providerName: 'Changed name',
      vendorConfig: { clientId: 'only-client-id' },
    })).rejects.toThrow(/missing required credentials/);

    const row = await scoped('calendar_providers').where({ id: created.id }).first();
    expect(row.provider_name).toBe('Original name');
    expect(await count('microsoft_calendar_provider_config')).toBe(0);
  });

  it('deleteProvider removes provider, vendor config and mappings', async () => {
    service = new CalendarProviderService();
    const created = await service.createProvider(baseData('microsoft', 'To delete', microsoftConfig()));
    const entryId = uuidv4();
    await scoped('calendar_event_mappings').insert({
      id: uuidv4(),
      tenant,
      calendar_provider_id: created.id,
      schedule_entry_id: entryId,
      external_event_id: 'ext-1',
      sync_status: 'synced',
      sync_direction: 'to_external',
      created_at: new Date(),
      updated_at: new Date(),
    }).catch(async () => {
      // schedule_entry FK: seed a minimal entry if the schema enforces one
      await scoped('schedule_entries').insert({
        tenant, entry_id: entryId, title: 'tx test', scheduled_start: new Date(), scheduled_end: new Date(),
        status: 'scheduled', work_item_type: 'ad_hoc', created_at: new Date(), updated_at: new Date(),
      });
      await scoped('calendar_event_mappings').insert({
        id: uuidv4(), tenant, calendar_provider_id: created.id, schedule_entry_id: entryId,
        external_event_id: 'ext-1', sync_status: 'synced', sync_direction: 'to_external',
        created_at: new Date(), updated_at: new Date(),
      });
    });
    expect(await count('calendar_event_mappings')).toBe(1);

    await service.deleteProvider(created.id, tenant);

    expect(await count('calendar_providers')).toBe(0);
    expect(await count('microsoft_calendar_provider_config')).toBe(0);
    expect(await count('calendar_event_mappings')).toBe(0);
    await scoped('schedule_entries').del();
  });
});
