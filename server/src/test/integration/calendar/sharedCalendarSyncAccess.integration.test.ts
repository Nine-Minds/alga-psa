import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../../test-utils/dbConfig.ts';
import ScheduleEntry from '@alga-psa/shared/models/scheduleEntry';
import { tenantDb } from '@alga-psa/db';
import { CalendarSyncService } from '@alga-psa/ee-calendar/lib/services/calendar/CalendarSyncService';
import { CalendarProviderService } from '@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService';
import { syncCalendarProviderImpl } from '@alga-psa/ee-calendar/lib/actions/integrations/calendarActions';
import { GoogleCalendarAdapter } from '@alga-psa/ee-calendar/lib/services/calendar/providers/GoogleCalendarAdapter';
import { MicrosoftCalendarAdapter } from '@alga-psa/ee-calendar/lib/services/calendar/providers/MicrosoftCalendarAdapter';

const fixture = vi.hoisted(() => ({
  db: null as Knex | null,
  trx: null as Knex.Transaction | null,
  tenant: '',
  canViewAll: false,
  providers: new Map<string, any>(),
  forceReadOnly: false,
  failAccessResolution: false,
  published: [] as Array<{ eventType: string; payload: any }>,
}));

vi.mock('@alga-psa/ee-calendar/lib/eventBus/publishers', () => ({
  publishEvent: async (event: { eventType: string; payload: any }) => {
    fixture.published.push(event);
  },
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
    resolveCalendarAccess: (...args: any[]) => fixture.failAccessResolution
      ? Promise.reject(new Error('access lookup unavailable'))
      : actual.resolveCalendarAccess(...args),
    evaluateEntryAccess: (entry: any, access: any) => fixture.forceReadOnly
      ? { access: 'full', canEdit: false }
      : actual.evaluateEntryAccess(entry, access),
  };
});

describe('shared-calendar provider sync access', () => {
  const tenant = uuidv4();
  const member = uuidv4();
  const otherAssignee = uuidv4();
  const secondOtherAssignee = uuidv4();
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
    }).onConflict(['tenant', 'calendar_id']).ignore();
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

  async function seedProviderAndMapping(entryId: string, userId: string, externalId = `external-${uuidv4()}`, providerKey = providerId, providerType: 'google' | 'microsoft' = 'google', syncDirection: 'bidirectional' | 'to_external' | 'from_external' = 'bidirectional') {
    await seedProvider(userId, providerKey, providerType, syncDirection);
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

  async function seedProvider(userId: string, providerKey = providerId, providerType: 'google' | 'microsoft' = 'google', syncDirection: 'bidirectional' | 'to_external' | 'from_external' = 'bidirectional') {
    const provider = {
      id: providerKey,
      tenant,
      user_id: userId,
      provider_type: providerType,
      provider_name: providerType === 'google' ? 'Test Google' : 'Test Outlook',
      calendar_id: 'primary',
      is_active: true,
      sync_direction: syncDirection,
      provider_config: { accessToken: 'test', refreshToken: 'test' },
    };
    fixture.providers.set(providerKey, provider);
    await scoped('calendar_providers').insert({
      id: providerKey,
      tenant,
      user_id: userId,
      provider_type: providerType,
      provider_name: providerType === 'google' ? 'Test Google' : 'Test Outlook',
      calendar_id: 'primary',
      is_active: true,
      sync_direction: syncDirection,
      status: 'connected',
      vendor_config: {},
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  beforeAll(async () => {
    db = await createTestDbConnection({ recreate: false });
    fixture.db = db;
    fixture.tenant = tenant;
    await db('tenants').insert({ tenant, client_name: 'Calendar Sync Access Test', email: `${tenant}@example.test`, created_at: new Date(), updated_at: new Date() }).onConflict('tenant').ignore();
    await seedUser(member);
    await seedUser(otherAssignee);
    await seedUser(secondOtherAssignee);
    service = new CalendarSyncService();
    (service as any).providerService = { getProvider: async (id: string) => fixture.providers.get(id) ?? null };
    (service as any).markProviderConnected = async () => {};
    (service as any).markProviderError = async () => {};
  });

  beforeEach(async () => {
    fixture.trx = await db.transaction();
    fixture.providers.clear();
    fixture.canViewAll = false;
    fixture.forceReadOnly = false;
    fixture.failAccessResolution = false;
    fixture.published.length = 0;
  });

  afterEach(async () => {
    await fixture.trx?.rollback().catch(() => undefined);
    fixture.trx = null;
    vi.restoreAllMocks();
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

  it.each(['google', 'microsoft'] as const)('re-pushes unauthorized %s edits exactly once and acknowledges the pushed version for webhook redelivery', async (providerType) => {
    const entryId = await seedGroupEntry([member, otherAssignee], { readMember: true });
    const externalId = await seedProviderAndMapping(entryId, member, `readonly-edit-${providerType}`, providerId, providerType);
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
    expect(fixture.published).toEqual([]);
    const mapping = await scoped('calendar_event_mappings').where({ schedule_entry_id: entryId, calendar_provider_id: providerId }).first();
    expect(new Date(mapping.external_last_modified).toISOString()).toBe(pushedEvent.updated);

    expect(await service.syncExternalEventToSchedule(externalId, providerId)).toMatchObject({ success: true, skipped: true });
    // A redelivered notification for the original stale version fetches the provider's current post-push event.
    currentEvent = pushedEvent;
    expect(await service.syncExternalEventToSchedule(externalId, providerId)).toMatchObject({ success: true, skipped: true });
    expect(adapter.updateEvent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['google', 'marker-only'],
    ['microsoft', 'marker-only'],
    ['microsoft', 'category-only'],
    ['google', 'html-notes'],
    ['microsoft', 'entity-notes'],
  ] as const)('does not re-push %s %s metadata for a read-only member', async (providerType, metadataKind) => {
    const entryId = await seedGroupEntry([member, otherAssignee], { readMember: true });
    const externalId = await seedProviderAndMapping(entryId, member, `metadata-${providerType}-${metadataKind}`, providerId, providerType);
    const originalNotes = metadataKind === 'html-notes' ? '<p>Alga notes</p>'
      : metadataKind === 'entity-notes' ? 'Literal &lt;tag&gt;' : 'Alga notes';
    await scoped('schedule_entries').where({ entry_id: entryId }).update({ notes: originalNotes });
    const description = metadataKind === 'html-notes' ? '<p>Alga notes</p>\n[Alga calendar: Sync access test]'
      : metadataKind === 'entity-notes' ? 'Literal &amp;lt;tag&amp;gt;\n<p>[Alga calendar: Sync access test]</p>'
      : metadataKind === 'category-only'
      ? '<html><body><p>Alga notes</p></body></html>'
      : providerType === 'microsoft'
        ? '<html><body><p>Alga notes</p><p>[Alga calendar: Sync access test]</p></body></html>'
        : 'Alga notes\n[Alga calendar: Sync access test]';
    const externalEvent = {
      id: externalId,
      title: 'Alga title',
      description,
      ...(providerType === 'microsoft' && metadataKind === 'category-only' ? { categories: ['Alga calendar: Sync access test'] } : {}),
      extendedProperties: { private: { 'alga-calendar-marker-name': 'Sync access test', 'alga-calendar-marker-note-count': '0', 'alga-calendar-marker-notes-format': 'text' } },
      status: 'confirmed',
      updated: '2026-08-02T00:00:00.000Z',
      start: { dateTime: '2026-09-01T10:00:00Z' },
      end: { dateTime: '2026-09-01T11:00:00Z' },
    };
    const adapter = {
      connect: vi.fn(async () => {}),
      getEvent: vi.fn(async () => externalEvent),
      updateEvent: vi.fn(async () => externalEvent),
      createEvent: vi.fn(async () => externalEvent),
      deleteEvent: vi.fn(async () => {}),
    };
    (service as any).createAdapter = async () => adapter;
    fixture.forceReadOnly = true;

    expect(await service.syncExternalEventToSchedule(externalId, providerId)).toMatchObject({ success: true, skipped: true });
    const row = await scoped('schedule_entries').where({ entry_id: entryId }).first();
    expect(row.title).toBe('Alga title');
    expect(row.notes).toBe(originalNotes);
    expect(adapter.updateEvent).not.toHaveBeenCalled();
    expect(fixture.published).toEqual([]);
    expect(await scoped('calendar_event_mappings').where({ schedule_entry_id: entryId }).first()).toMatchObject({ sync_status: 'synced' });
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
    // Announced so the other assignee's copy is updated; the source provider is named so it is skipped.
    expect(fixture.published).toEqual([{
      eventType: 'SCHEDULE_ENTRY_UPDATED',
      payload: expect.objectContaining({
        tenantId: tenant,
        userId: member,
        entryId,
        changes: expect.objectContaining({
          sourceCalendarProviderId: providerId,
          after: { assignedUserIds: expect.arrayContaining([member, otherAssignee]) },
        }),
      }),
    }]);
  });

  it.each(['google', 'microsoft'] as const)(
    'accepts %s-authored notes before any provider write and keeps the mapped copy stable', async (providerType) => {
      const entryId = await seedGroupEntry([member, otherAssignee]);
      await scoped('calendar_shares').insert({
        tenant, calendar_id: groupCalendarId, grantee_type: 'user', grantee_id: member,
        access_level: 'edit', created_by: otherAssignee,
      });
      const externalId = await seedProviderAndMapping(entryId, member, `provider-notes-${providerType}`, providerId, providerType);
      const notes = 'Provider-authored note';
      const description = providerType === 'microsoft'
        ? `<html><body><p>${notes}</p><p>[Alga calendar: Sync access test]</p></body></html>`
        : `${notes}\n[Alga calendar: Sync access test]`;
      const event = {
        id: externalId,
        title: 'Alga title',
        description,
        ...(providerType === 'microsoft' ? { categories: ['Alga calendar: Sync access test'] } : {}),
        extendedProperties: { private: {
          'alga-calendar-marker-name': 'Sync access test',
          'alga-calendar-marker-note-count': '0',
          'alga-calendar-marker-notes-format': 'text',
        } },
        status: 'confirmed',
        updated: '2026-08-02T00:00:00.000Z',
        start: { dateTime: '2026-09-01T10:00:00Z' },
        end: { dateTime: '2026-09-01T11:00:00Z' },
      };
      const adapter = {
        connect: vi.fn(async () => {}),
        getEvent: vi.fn(async () => event),
        updateEvent: vi.fn(async () => event),
        createEvent: vi.fn(async () => event),
      };
      (service as any).createAdapter = async () => adapter;
      const originalMapping = await scoped('calendar_event_mappings')
        .where({ schedule_entry_id: entryId, calendar_provider_id: providerId }).first();

      expect(await service.syncExternalEventToSchedule(externalId, providerId)).toMatchObject({ success: true });
      const row = await scoped('schedule_entries').where({ entry_id: entryId }).first();
      const mapping = await scoped('calendar_event_mappings')
        .where({ schedule_entry_id: entryId, calendar_provider_id: providerId }).first();
      expect(row.notes).toBe(notes);
      expect(row.entry_id).toBe(entryId);
      expect(mapping.id).toBe(originalMapping.id);
      expect(mapping.external_event_id).toBe(externalId);
      expect(event.description).toContain('[Alga calendar: Sync access test]');
      if (providerType === 'microsoft') {
        expect(event.categories).toEqual(['Alga calendar: Sync access test']);
      }
      expect(adapter.updateEvent).not.toHaveBeenCalled();
    }
  );

  it('does not announce a provider echo of the version Alga already holds', async () => {
    const entryId = await seedGroupEntry([member, otherAssignee]);
    await scoped('calendar_shares').insert({ tenant, calendar_id: groupCalendarId, grantee_type: 'user', grantee_id: member, access_level: 'edit', created_by: otherAssignee });
    const externalId = await seedProviderAndMapping(entryId, member, 'editable-echo');
    // Same content as the entry, but Outlook-style HTML notes and a newer provider timestamp
    // (the notification raced ahead of the mapping update for Alga's own push).
    const echoedEvent = {
      id: externalId,
      title: 'Alga title',
      description: '<html><head></head><body><p>Alga notes</p></body></html>',
      status: 'confirmed',
      updated: '2026-08-06T00:00:00.000Z',
      start: { dateTime: '2026-09-01T10:00:00Z' },
      end: { dateTime: '2026-09-01T11:00:00Z' },
    };
    const adapter = {
      connect: vi.fn(async () => {}),
      getEvent: vi.fn(async () => echoedEvent),
      updateEvent: vi.fn(async () => echoedEvent),
      createEvent: vi.fn(async () => echoedEvent),
      deleteEvent: vi.fn(async () => {}),
    };
    (service as any).createAdapter = async () => adapter;

    expect(await service.syncExternalEventToSchedule(externalId, providerId)).toMatchObject({ success: true });
    expect(fixture.published).toEqual([]);
  });

  it('does not inject group metadata into an entry on an actual personal calendar row', async () => {
    const personalCalendarId = uuidv4();
    await scoped('calendars').insert({
      tenant,
      calendar_id: personalCalendarId,
      calendar_type: 'personal',
      owner_user_id: member,
      created_by: member,
    });
    const entry = await ScheduleEntry.create(fixture.trx!, tenant, {
      title: 'Personal entry',
      notes: 'Keep [Alga calendar: Personal] as authored text',
      scheduled_start: new Date('2026-09-01T10:00:00Z'),
      scheduled_end: new Date('2026-09-01T11:00:00Z'),
      status: 'scheduled',
      work_item_type: 'ad_hoc',
      calendar_id: personalCalendarId,
    } as any, { assignedUserIds: [member] });
    const created: any[] = [];
    const adapter = {
      connect: vi.fn(async () => {}),
      createEvent: vi.fn(async (event: any) => {
        created.push(event);
        return { ...event, id: 'personal-copy', updated: '2026-08-02T00:00:00.000Z' };
      }),
      updateEvent: vi.fn(),
    };
    await seedProvider(member, providerId);
    (service as any).createAdapter = async () => adapter;

    expect(await service.syncScheduleEntryToExternal(entry.entry_id, providerId)).toMatchObject({
      success: true,
      externalEventId: 'personal-copy',
    });
    expect(created[0].description).toBe('Keep [Alga calendar: Personal] as authored text');
    expect(created[0].categories).toBeUndefined();
    expect(created[0].extendedProperties?.private).not.toHaveProperty('alga-calendar-marker-name');
  });

  it.each(['google', 'microsoft'] as const)(
    'blocks %s exports to inaccessible entries for both new and existing mappings', async (providerType) => {
      const entryId = await seedGroupEntry([otherAssignee], { readMember: true });
      const externalId = await seedProviderAndMapping(entryId, member, `revoked-${providerType}`, providerId, providerType);
      await scoped('calendar_shares').where({ calendar_id: groupCalendarId, grantee_type: 'user', grantee_id: member }).del();
      const calendarless = await ScheduleEntry.create(fixture.trx!, tenant, {
        title: 'Private calendar-less detail', notes: 'Secret notes',
        scheduled_start: new Date('2026-09-01T10:00:00Z'), scheduled_end: new Date('2026-09-01T11:00:00Z'),
        status: 'scheduled', work_item_type: 'ad_hoc',
      } as any, { assignedUserIds: [otherAssignee] });
      const writes: any[] = [];
      const adapter = {
        connect: vi.fn(async () => {}),
        updateEvent: vi.fn(async (id: string, event: any) => { writes.push(['update', id, event]); return { id, updated: new Date().toISOString() }; }),
        createEvent: vi.fn(async (event: any) => { writes.push(['create', event]); return { id: 'new-copy', updated: new Date().toISOString() }; }),
      };
      (service as any).createAdapter = async () => adapter;

      expect(await service.syncScheduleEntryToExternal(entryId, providerId, true)).toMatchObject({ success: true, skipped: true });
      expect(await service.syncScheduleEntryToExternal(calendarless.entry_id, providerId, true)).toMatchObject({ success: true, skipped: true });
      expect(writes).toEqual([]);
      expect(adapter.updateEvent).not.toHaveBeenCalledWith(externalId, expect.anything());
      expect(adapter.createEvent).not.toHaveBeenCalled();
    }
  );

  it.each(['google', 'microsoft'] as const)(
    'does not disclose payload fields to %s free/busy provider owners', async (providerType) => {
      const entryId = await seedGroupEntry([otherAssignee]);
      await scoped('calendar_shares').insert({ tenant, calendar_id: groupCalendarId, grantee_type: 'user', grantee_id: member, access_level: 'free_busy', created_by: otherAssignee });
      await seedProviderAndMapping(entryId, member, `busy-${providerType}`, providerId, providerType);
      const adapter = { connect: vi.fn(async () => {}), updateEvent: vi.fn(), createEvent: vi.fn() };
      (service as any).createAdapter = async () => adapter;

      expect(await service.syncScheduleEntryToExternal(entryId, providerId, true)).toMatchObject({ success: true, skipped: true, reason: expect.stringContaining('busy-only') });
      expect(adapter.updateEvent).not.toHaveBeenCalled();
      expect(adapter.createEvent).not.toHaveBeenCalled();
    }
  );

  it.each(['google', 'microsoft'] as const)(
    'keeps eligible read-only shared multi-assignee %s exports', async (providerType) => {
      const entryId = await seedGroupEntry([otherAssignee, secondOtherAssignee], { readMember: true });
      await seedProvider(member, providerId, providerType);
      const payloads: any[] = [];
      const adapter = {
        connect: vi.fn(async () => {}),
        createEvent: vi.fn(async (event: any) => { payloads.push(event); return { id: 'readonly-copy', updated: new Date().toISOString() }; }),
        updateEvent: vi.fn(),
      };
      (service as any).createAdapter = async () => adapter;

      expect(await service.syncScheduleEntryToExternal(entryId, providerId, true)).toMatchObject({ success: true });
      expect(adapter.createEvent).toHaveBeenCalledTimes(1);
      const expectedDescription = providerType === 'microsoft'
        ? 'Alga notes\n<p>[Alga calendar: Sync access test]</p>'
        : 'Alga notes\n[Alga calendar: Sync access test]';
      expect(payloads[0].description).toBe(expectedDescription);
      expect(payloads[0].title).toBe('Alga title');
      expect(payloads[0].title).not.toMatch(/^\[Alga calendar:/);
      if (providerType === 'microsoft') {
        expect(payloads[0].categories).toEqual(['Alga calendar: Sync access test']);
      } else {
        expect(payloads[0].categories).toBeUndefined();
      }
    }
  );

  it.each(['google', 'microsoft'] as const)(
    'blocks role-free Sync Now writes through the real outbound guard for %s, including inaccessible group creates and calendar-less mapped updates', async (providerType) => {
      const groupMappedId = await seedGroupEntry([otherAssignee], { readMember: true });
      const groupNewId = await seedGroupEntry([otherAssignee]);
      const calendarlessMapped = await ScheduleEntry.create(fixture.trx!, tenant, {
        title: 'Mapped calendar-less secret', notes: 'Mapped secret notes',
        scheduled_start: new Date(Date.now() + 60 * 60 * 1000), scheduled_end: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: 'scheduled', work_item_type: 'ad_hoc',
      } as any, { assignedUserIds: [otherAssignee] });
      const calendarlessNew = await ScheduleEntry.create(fixture.trx!, tenant, {
        title: 'New calendar-less secret', notes: 'New secret notes',
        scheduled_start: new Date(Date.now() + 3 * 60 * 60 * 1000), scheduled_end: new Date(Date.now() + 4 * 60 * 60 * 1000),
        status: 'scheduled', work_item_type: 'ad_hoc',
      } as any, { assignedUserIds: [otherAssignee] });
      // The service-level helpers create entries outside Sync Now's rolling window;
      // put the two group cases inside it as well.
      const inWindowStart = new Date(Date.now() + 5 * 60 * 60 * 1000);
      const inWindowEnd = new Date(Date.now() + 6 * 60 * 60 * 1000);
      await scoped('schedule_entries').whereIn('entry_id', [groupMappedId, groupNewId]).update({ scheduled_start: inWindowStart, scheduled_end: inWindowEnd });

      const mappedGroupExternalId = await seedProviderAndMapping(groupMappedId, member, `sync-now-group-${providerType}`, providerId, providerType, 'to_external');
      const personalExternalId = `sync-now-personal-${providerType}`;
      await scoped('calendar_event_mappings').insert({
        id: uuidv4(), tenant, calendar_provider_id: providerId,
        schedule_entry_id: calendarlessMapped.entry_id,
        external_event_id: personalExternalId,
        sync_status: 'synced', sync_direction: 'to_external',
        last_synced_at: new Date(), alga_last_modified: calendarlessMapped.updated_at,
        external_last_modified: new Date('2026-08-01T00:00:00Z'), created_at: new Date(), updated_at: new Date(),
      });
      await scoped('calendar_shares').where({ calendar_id: groupCalendarId, grantee_id: member }).del();

      const providerWrites: any[] = [];
      const adapter = {
        connect: vi.fn(async () => {}),
        updateEvent: vi.fn(async (id: string, payload: any) => { providerWrites.push(['update', id, payload]); return { id, updated: new Date().toISOString() }; }),
        createEvent: vi.fn(async (payload: any) => { providerWrites.push(['create', payload]); return { id: `new-${providerType}`, updated: new Date().toISOString() }; }),
      };
      const getProvider = vi.spyOn(CalendarProviderService.prototype, 'getProvider').mockImplementation(async (id: string) => fixture.providers.get(id) ?? null);
      const updateProviderStatus = vi.spyOn(CalendarProviderService.prototype, 'updateProviderStatus').mockResolvedValue();
      const createAdapter = vi.spyOn(CalendarSyncService.prototype as any, 'createAdapter').mockResolvedValue(adapter);
      const syncSpy = vi.spyOn(CalendarSyncService.prototype, 'syncScheduleEntryToExternal');
      const googleConnect = vi.spyOn(GoogleCalendarAdapter.prototype, 'connect').mockResolvedValue();
      const microsoftConnect = vi.spyOn(MicrosoftCalendarAdapter.prototype, 'connect').mockResolvedValue();

      expect(await scoped('user_roles').where({ user_id: member })).toHaveLength(0);
      expect(await syncCalendarProviderImpl({ user_id: member }, { tenant }, providerId)).toMatchObject({ success: true, started: true });
      await vi.waitFor(() => {
        expect(syncSpy).toHaveBeenCalledTimes(4);
        expect(updateProviderStatus).toHaveBeenCalled();
      });
      expect(syncSpy).toHaveBeenCalledWith(groupMappedId, providerId, true);
      expect(syncSpy).toHaveBeenCalledWith(calendarlessMapped.entry_id, providerId, true);
      expect(syncSpy).toHaveBeenCalledWith(groupNewId, providerId, true);
      expect(syncSpy).toHaveBeenCalledWith(calendarlessNew.entry_id, providerId, true);
      expect(providerWrites).toEqual([]);
      expect(adapter.updateEvent).not.toHaveBeenCalledWith(mappedGroupExternalId, expect.anything());
      expect(adapter.updateEvent).not.toHaveBeenCalledWith(personalExternalId, expect.anything());

      syncSpy.mockRestore();
      createAdapter.mockRestore();
      updateProviderStatus.mockRestore();
      getProvider.mockRestore();
    }
  );

  it.each(['google', 'microsoft'] as const)(
    'fails closed when %s outbound access lookup fails', async (providerType) => {
      const entryId = await seedGroupEntry([member]);
      await seedProviderAndMapping(entryId, member, `lookup-error-${providerType}`, providerId, providerType);
      fixture.failAccessResolution = true;
      const adapter = { connect: vi.fn(async () => {}), updateEvent: vi.fn(), createEvent: vi.fn() };
      (service as any).createAdapter = async () => adapter;

      expect(await service.syncScheduleEntryToExternal(entryId, providerId, true)).toMatchObject({ success: false });
      expect(adapter.updateEvent).not.toHaveBeenCalled();
      expect(adapter.createEvent).not.toHaveBeenCalled();
    }
  );

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

  function providerNotFound(context: string) {
    // Shape of BaseCalendarAdapter.handleError for a Graph 404.
    return Object.assign(new Error(`Error in ${context}: Request failed with status code 404 (code: ErrorItemNotFound)`), {
      status: 404,
      code: 'ErrorItemNotFound',
    });
  }

  it('recreates a copy that vanished from the provider before archive once the calendar is restored', async () => {
    const entryId = await seedGroupEntry([member]);
    const externalId = await seedProviderAndMapping(entryId, member, 'vanished-before-archive');
    const adapter = {
      connect: vi.fn(async () => {}),
      deleteEvent: vi.fn(async () => { throw providerNotFound('deleteEvent'); }),
      updateEvent: vi.fn(async () => { throw providerNotFound('updateEvent'); }),
      createEvent: vi.fn(async () => ({ id: 'recreated-copy', updated: '2026-08-05T00:00:00.000Z' })),
    };
    (service as any).createAdapter = async () => adapter;

    await tenantDb(fixture.trx!, tenant).table('calendars').where({ calendar_id: groupCalendarId }).update({ is_archived: true });
    await service.removeProviderCopy(entryId, providerId);
    expect(adapter.deleteEvent).toHaveBeenCalledWith(externalId);
    expect(await scoped('calendar_event_mappings').where({ schedule_entry_id: entryId })).toHaveLength(0);

    await tenantDb(fixture.trx!, tenant).table('calendars').where({ calendar_id: groupCalendarId }).update({ is_archived: false });
    expect(await service.syncScheduleEntryToExternal(entryId, providerId)).toMatchObject({ success: true, externalEventId: 'recreated-copy' });
    expect(adapter.updateEvent).not.toHaveBeenCalled();
    const mappings = await scoped('calendar_event_mappings').where({ schedule_entry_id: entryId });
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({ external_event_id: 'recreated-copy', sync_status: 'synced' });
  });

  it('replaces a stale mapping with a fresh provider copy when the mapped event no longer exists', async () => {
    const entryId = await seedGroupEntry([member]);
    const staleExternalId = await seedProviderAndMapping(entryId, member, 'stale-mapping');
    const adapter = {
      connect: vi.fn(async () => {}),
      updateEvent: vi.fn(async () => { throw providerNotFound('updateEvent'); }),
      createEvent: vi.fn(async () => ({ id: 'fresh-copy', updated: '2026-08-05T00:00:00.000Z' })),
    };
    (service as any).createAdapter = async () => adapter;

    expect(await service.syncScheduleEntryToExternal(entryId, providerId, true)).toMatchObject({ success: true, externalEventId: 'fresh-copy' });
    expect(adapter.updateEvent).toHaveBeenCalledWith(staleExternalId, expect.anything());
    expect(adapter.createEvent).toHaveBeenCalledTimes(1);
    const mappings = await scoped('calendar_event_mappings').where({ schedule_entry_id: entryId });
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({ external_event_id: 'fresh-copy', sync_status: 'synced' });
  });

  it('keeps the mapping when removing an archived copy fails for a reason other than the event being gone', async () => {
    const entryId = await seedGroupEntry([member]);
    await seedProviderAndMapping(entryId, member, 'archive-transient-failure');
    const adapter = {
      connect: vi.fn(async () => {}),
      deleteEvent: vi.fn(async () => {
        throw Object.assign(new Error('Error in deleteEvent: Request failed with status code 503'), { status: 503, code: 503 });
      }),
    };
    (service as any).createAdapter = async () => adapter;

    await expect(service.removeProviderCopy(entryId, providerId)).rejects.toThrow('503');
    expect(await scoped('calendar_event_mappings').where({ schedule_entry_id: entryId })).toHaveLength(1);
  });
});
