import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../../test-utils/dbConfig.ts';
import ScheduleEntry from '@alga-psa/shared/models/scheduleEntry';
import { tenantDb } from '@alga-psa/db';
import { CalendarSyncService } from '@alga-psa/ee-calendar/lib/services/calendar/CalendarSyncService';

const fixture = vi.hoisted(() => ({
  db: null as Knex | null,
  trx: null as Knex.Transaction | null,
  tenant: '',
  canViewAll: false,
  providers: new Map<string, any>(),
  forceReadOnly: false,
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: fixture.trx ?? fixture.db, tenant: fixture.tenant }),
}));

  vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/auth')>(),
  hasPermission: async (user: { user_id: string }, resource: string, action: string) =>
    resource === 'user_schedule' && action === 'update' && fixture.canViewAll,
}));

vi.mock('@alga-psa/scheduling/lib/calendarAccess', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/scheduling/lib/calendarAccess')>();
  return {
    ...actual,
    evaluateEntryAccess: (entry: any, access: any) => fixture.forceReadOnly
      ? { access: 'full', canEdit: false }
      : actual.evaluateEntryAccess(entry, access),
  };
});

describe('shared-calendar provider sync access', () => {
  const tenant = uuidv4();
  const member = uuidv4();
  const otherAssignee = uuidv4();
  const providerId = uuidv4();
  const groupCalendarId = uuidv4();
  let db: Knex;
  let service: CalendarSyncService;

  const scoped = (table: string) => tenantDb(fixture.trx ?? db, tenant).table(table);

  async function seedUser(userId: string) {
    await scoped('users').insert({
      tenant,
      user_id: userId,
      username: `calendar-${userId.slice(0, 6)}`,
      email: `${userId}@example.test`,
      user_type: 'internal',
      hashed_password: 'not-used',
      created_at: new Date(),
      updated_at: new Date(),
    }).onConflict(['tenant', 'user_id']).ignore();
  }

  async function seedGroupEntry(assignees: string[], opts: { readMember?: boolean; archived?: boolean } = {}) {
    await scoped('calendars').insert({
      tenant,
      calendar_id: groupCalendarId,
      calendar_type: 'group',
      name: 'Sync access test',
      is_archived: !!opts.archived,
      created_at: new Date(),
      updated_at: new Date(),
    });
    if (opts.readMember) {
      await scoped('calendar_shares').insert({
        tenant,
        calendar_id: groupCalendarId,
        grantee_type: 'user',
        grantee_id: member,
        access_level: 'read',
        created_by: otherAssignee,
      });
    }
    const entry = await ScheduleEntry.create(fixture.trx ?? db, tenant, {
      title: 'Alga title',
      notes: 'Alga notes',
      scheduled_start: new Date('2026-09-01T10:00:00Z'),
      scheduled_end: new Date('2026-09-01T11:00:00Z'),
      status: 'scheduled',
      work_item_type: 'ad_hoc',
      calendar_id: groupCalendarId,
    } as any, { assignedUserIds: assignees });
    return entry.entry_id;
  }

  async function seedProviderAndMapping(entryId: string, userId: string, externalId = `external-${uuidv4()}`, providerKey = providerId) {
    const provider = {
      id: providerKey,
      tenant,
      user_id: userId,
      provider_type: 'google',
      provider_name: 'Test Google',
      calendar_id: 'primary',
      is_active: true,
      sync_direction: 'bidirectional',
      provider_config: { accessToken: 'test', refreshToken: 'test' },
    };
    fixture.providers.set(providerKey, provider);
    await scoped('calendar_providers').insert({
      id: providerKey,
      tenant,
      user_id: userId,
      provider_type: 'google',
      provider_name: 'Test Google',
      calendar_id: 'primary',
      is_active: true,
      sync_direction: 'bidirectional',
      status: 'connected',
      vendor_config: {},
      created_at: new Date(),
      updated_at: new Date(),
    });
    await scoped('calendar_event_mappings').insert({
      id: uuidv4(),
      tenant,
      calendar_provider_id: providerKey,
      schedule_entry_id: entryId,
      external_event_id: externalId,
      sync_status: 'synced',
      sync_direction: 'to_external',
      last_synced_at: new Date(),
      alga_last_modified: new Date('2026-08-01T00:00:00Z'),
      external_last_modified: new Date('2026-08-01T00:00:00Z'),
      created_at: new Date(),
      updated_at: new Date(),
    });
    const entry = await ScheduleEntry.get(fixture.trx ?? db, tenant, entryId);
    await scoped('calendar_event_mappings').where({ schedule_entry_id: entryId, calendar_provider_id: providerKey })
      .update({ alga_last_modified: entry?.updated_at, last_synced_at: entry?.updated_at });
    return externalId;
  }

  beforeAll(async () => {
    db = await createTestDbConnection({ recreate: false });
    fixture.db = db;
    fixture.tenant = tenant;
    await db('tenants').insert({ tenant, client_name: 'Calendar Sync Access Test', email: `${tenant}@example.test`, created_at: new Date(), updated_at: new Date() }).onConflict('tenant').ignore();
    await seedUser(member);
    await seedUser(otherAssignee);
    service = new CalendarSyncService();
    (service as any).providerService = { getProvider: async (id: string) => fixture.providers.get(id) ?? null };
    (service as any).markProviderConnected = async () => {};
    (service as any).markProviderError = async () => {};
  });

  beforeEach(async () => {
    fixture.trx = await db.transaction();
    fixture.canViewAll = false;
    fixture.forceReadOnly = false;
  });

  afterEach(async () => {
    await fixture.trx?.rollback().catch(() => undefined);
    fixture.trx = null;
  });

  afterAll(async () => {
    await tenantDb(db, tenant).table('calendar_event_mappings').del();
    await tenantDb(db, tenant).table('schedule_entry_assignees').del();
    await tenantDb(db, tenant).table('schedule_entries').del();
    await tenantDb(db, tenant).table('calendar_shares').del();
    await tenantDb(db, tenant).table('calendars').del();
    await tenantDb(db, tenant).table('calendar_providers').del();
    await tenantDb(db, tenant).table('users').del();
    await tenantDb(db, tenant).unscoped('tenants', 'remove isolated calendar sync access test tenant').where({ tenant }).del();
    await db.destroy();
  });

  it('removes only a read-only member from a two-assignee group entry on provider delete', async () => {
    const entryId = await seedGroupEntry([member, otherAssignee], { readMember: true });
    await seedProviderAndMapping(entryId, member, 'member-delete');
    const otherProviderId = uuidv4();
    const otherMappingId = uuidv4();
    await scoped('calendar_providers').insert({ id: otherProviderId, tenant, user_id: otherAssignee, provider_type: 'google', provider_name: 'Other', calendar_id: 'primary', is_active: true, sync_direction: 'bidirectional', status: 'connected', vendor_config: {}, created_at: new Date(), updated_at: new Date() });
    await scoped('calendar_event_mappings').insert({ id: otherMappingId, tenant, calendar_provider_id: otherProviderId, schedule_entry_id: entryId, external_event_id: 'other-copy', sync_status: 'synced', sync_direction: 'to_external', created_at: new Date(), updated_at: new Date() });

    expect(await service.handleInboundProviderDelete(entryId, providerId)).toMatchObject({ success: true });
    const entry = await ScheduleEntry.get(fixture.trx!, tenant, entryId);
    expect(entry?.assigned_user_ids).toEqual([otherAssignee]);
    expect(await scoped('schedule_entries').where({ entry_id: entryId }).first()).toBeDefined();
    expect(await scoped('calendar_event_mappings').where({ schedule_entry_id: entryId, calendar_provider_id: providerId }).first()).toBeUndefined();
    expect(await scoped('calendar_event_mappings').where({ id: otherMappingId }).first()).toBeDefined();
  });

  it('deletes a sole-assignee entry when that assignee sends a provider delete', async () => {
    const entryId = await ScheduleEntry.create(fixture.trx!, tenant, {
      title: 'Sole assignee', scheduled_start: new Date('2026-09-01T10:00:00Z'),
      scheduled_end: new Date('2026-09-01T11:00:00Z'), status: 'scheduled', work_item_type: 'ad_hoc',
    } as any, { assignedUserIds: [member] }).then(entry => entry.entry_id);
    await seedProviderAndMapping(entryId, member, 'sole-delete');

    expect(await service.handleInboundProviderDelete(entryId, providerId)).toMatchObject({ success: true });
    expect(await scoped('schedule_entries').where({ entry_id: entryId }).first()).toBeUndefined();
  });

  it('keeps a read-only sole-assignee group entry with no assignees after provider delete', async () => {
    const entryId = await seedGroupEntry([member], { readMember: true });
    await seedProviderAndMapping(entryId, member, 'last-assignee-delete');
    fixture.forceReadOnly = true;

    expect(await service.handleInboundProviderDelete(entryId, providerId)).toMatchObject({ success: true });
    const entry = await ScheduleEntry.get(fixture.trx!, tenant, entryId);
    expect(entry?.assigned_user_ids).toEqual([]);
    expect(await scoped('schedule_entries').where({ entry_id: entryId }).first()).toBeDefined();
    expect(await scoped('calendar_event_mappings').where({ schedule_entry_id: entryId, calendar_provider_id: providerId }).first()).toBeUndefined();
  });

  it('re-pushes unauthorized edits after commit and acknowledges the pushed version for webhook redelivery', async () => {
    const entryId = await seedGroupEntry([member, otherAssignee], { readMember: true });
    const externalId = await seedProviderAndMapping(entryId, member, 'readonly-edit');
    const staleEvent = {
      id: externalId,
      title: 'Provider edit',
      description: 'Changed externally',
      status: 'confirmed',
      updated: '2026-08-02T00:00:00.000Z',
      start: { dateTime: '2026-09-01T12:00:00Z' },
      end: { dateTime: '2026-09-01T13:00:00Z' },
    };
    const pushedEvent = { ...staleEvent, title: 'Alga title', updated: '2026-08-03T00:00:00.000Z' };
    let currentEvent = staleEvent;
    const adapter = {
      connect: vi.fn(async () => {}),
      getEvent: vi.fn(async () => currentEvent),
      updateEvent: vi.fn(async () => {
        currentEvent = pushedEvent;
        return pushedEvent;
      }),
      createEvent: vi.fn(async () => pushedEvent),
      deleteEvent: vi.fn(async () => {}),
    };
    (service as any).createAdapter = async () => adapter;

    expect(await service.syncExternalEventToSchedule(externalId, providerId)).toMatchObject({ success: true, skipped: true });
    const row = await scoped('schedule_entries').where({ entry_id: entryId }).first();
    expect(row.title).toBe('Alga title');
    expect(adapter.updateEvent).toHaveBeenCalledTimes(1);
    const mapping = await scoped('calendar_event_mappings').where({ schedule_entry_id: entryId, calendar_provider_id: providerId }).first();
    expect(new Date(mapping.external_last_modified).toISOString()).toBe(pushedEvent.updated);

    expect(await service.syncExternalEventToSchedule(externalId, providerId)).toMatchObject({ success: true, skipped: true });
    // A redelivered notification for the original stale version fetches the provider's current post-push event.
    currentEvent = pushedEvent;
    expect(await service.syncExternalEventToSchedule(externalId, providerId)).toMatchObject({ success: true, skipped: true });
    expect(adapter.updateEvent).toHaveBeenCalledTimes(1);
  });

  it('applies an inbound edit when the provider user has group-calendar edit access', async () => {
    const entryId = await seedGroupEntry([member, otherAssignee]);
    await scoped('calendar_shares').insert({ tenant, calendar_id: groupCalendarId, grantee_type: 'user', grantee_id: member, access_level: 'edit', created_by: otherAssignee });
    const externalId = await seedProviderAndMapping(entryId, member, 'editable-edit');
    const externalEvent = {
      id: externalId,
      title: 'Updated title',
      description: 'Updated notes',
      status: 'confirmed',
      updated: '2026-08-02T00:00:00.000Z',
      start: { dateTime: '2026-09-01T12:00:00Z' },
      end: { dateTime: '2026-09-01T13:00:00Z' },
    };
    const adapter = {
      connect: vi.fn(async () => {}),
      getEvent: vi.fn(async () => externalEvent),
      updateEvent: vi.fn(async () => externalEvent),
      createEvent: vi.fn(async () => externalEvent),
      deleteEvent: vi.fn(async () => {}),
    };
    (service as any).createAdapter = async () => adapter;

    expect(await service.syncExternalEventToSchedule(externalId, providerId)).toMatchObject({ success: true });
    const row = await scoped('schedule_entries').where({ entry_id: entryId }).first();
    expect(row.title).toBe('Updated title');
    expect(row.notes).toBe('Updated notes');
  });

  it('removes archived copies, ignores mapped-entry webhooks, and recreates copies after restore', async () => {
    const entryId = await seedGroupEntry([member, otherAssignee]);
    const otherProviderId = uuidv4();
    const memberExternalId = await seedProviderAndMapping(entryId, member, 'archive-member', providerId);
    const otherExternalId = await seedProviderAndMapping(entryId, otherAssignee, 'archive-other', otherProviderId);
    const adapters = new Map<string, any>();
    for (const [id, oldExternalId] of [[providerId, memberExternalId], [otherProviderId, otherExternalId]] as const) {
      adapters.set(id, {
        connect: vi.fn(async () => {}),
        getEvent: vi.fn(async () => ({
          id: oldExternalId,
          title: 'Provider changed archived entry',
          status: 'confirmed',
          updated: '2026-08-04T00:00:00.000Z',
          start: { dateTime: '2026-09-01T12:00:00Z' },
          end: { dateTime: '2026-09-01T13:00:00Z' },
          extendedProperties: { private: { 'alga-entry-id': entryId } },
        })),
        deleteEvent: vi.fn(async () => {}),
        createEvent: vi.fn(async () => ({ id: `restored-${id}`, updated: '2026-08-05T00:00:00.000Z' })),
        updateEvent: vi.fn(async () => ({ id: oldExternalId, updated: '2026-08-05T00:00:00.000Z' })),
      });
    }
    (service as any).createAdapter = async (provider: { id: string }) => adapters.get(provider.id);

    await tenantDb(fixture.trx!, tenant).table('calendars').where({ calendar_id: groupCalendarId }).update({ is_archived: true });
    await service.removeProviderCopy(entryId, providerId);
    await service.removeProviderCopy(entryId, otherProviderId);
    expect(adapters.get(providerId).deleteEvent).toHaveBeenCalledWith(memberExternalId);
    expect(adapters.get(otherProviderId).deleteEvent).toHaveBeenCalledWith(otherExternalId);
    expect(await scoped('calendar_event_mappings').where({ schedule_entry_id: entryId })).toHaveLength(0);

    const unchangedTitle = (await scoped('schedule_entries').where({ entry_id: entryId }).first()).title;
    expect(await service.syncExternalEventToSchedule(memberExternalId, providerId)).toMatchObject({ success: true, skipped: true });
    expect((await scoped('schedule_entries').where({ entry_id: entryId }).first()).title).toBe(unchangedTitle);

    await tenantDb(fixture.trx!, tenant).table('calendars').where({ calendar_id: groupCalendarId }).update({ is_archived: false });
    await service.syncScheduleEntryToExternal(entryId, providerId);
    await service.syncScheduleEntryToExternal(entryId, otherProviderId);
    expect(adapters.get(providerId).createEvent).toHaveBeenCalledTimes(1);
    expect(adapters.get(otherProviderId).createEvent).toHaveBeenCalledTimes(1);
    expect(await scoped('calendar_event_mappings').where({ schedule_entry_id: entryId })).toHaveLength(2);
  });
});
