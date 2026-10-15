// Cross-implementation parity belongs in the server test layer to avoid package-to-server dependency cycles.
import { describe, expect, it, vi } from 'vitest';
import type { CalendarProviderConfig, IScheduleEntry } from '@alga-psa/types';
import { mapScheduleEntryToExternalEvent, mapExternalEventToScheduleEntry } from '../../../../../packages/integrations/src/utils/calendar/eventMapping';
import { MicrosoftCalendarAdapter } from '../../../../../packages/integrations/src/services/calendar/providers/MicrosoftCalendarAdapter';
import { CalendarProviderService } from '../../../../../packages/integrations/src/services/calendar/CalendarProviderService';
import { MicrosoftCalendarAdapter as EnterpriseMicrosoftCalendarAdapter } from '../../../../../ee/packages/calendar/src/lib/services/calendar/providers/MicrosoftCalendarAdapter';
import { MicrosoftCalendarAdapter as LegacyMicrosoftCalendarAdapter } from '../../../services/calendar/providers/MicrosoftCalendarAdapter';

const config: CalendarProviderConfig = {
  id: 'provider', tenant: 'tenant', user_id: 'user', name: 'Outlook',
  provider_type: 'microsoft', calendar_id: 'calendar', active: true,
  sync_direction: 'bidirectional', connection_status: 'connected',
  created_at: '', updated_at: '', provider_config: {},
};

describe('MicrosoftCalendarAdapter shared calendar categories', () => {
  it.each([
    ['workspace', MicrosoftCalendarAdapter],
    ['enterprise', EnterpriseMicrosoftCalendarAdapter],
    ['server', LegacyMicrosoftCalendarAdapter],
  ] as const)('%s creates the mailbox master category with a supported Graph color', async (_name, Adapter) => {
    const adapter = new Adapter(config) as any;
    adapter.httpClient = {
      get: vi.fn().mockResolvedValue({ data: { value: [] } }),
      post: vi.fn().mockResolvedValue({ data: { displayName: 'Alga calendar: On-call' } }),
    };
    await adapter.ensureMasterCategories(['Alga calendar: On-call']);
    expect(adapter.httpClient.post).toHaveBeenCalledWith('/me/outlook/masterCategories', {
      displayName: 'Alga calendar: On-call', color: 'preset0',
    });
  });

  it.each([
    ['workspace', MicrosoftCalendarAdapter],
    ['enterprise', EnterpriseMicrosoftCalendarAdapter],
    ['server', LegacyMicrosoftCalendarAdapter],
  ] as const)('%s retrieves provenance with explicit Graph property filters', async (_name, Adapter) => {
    const adapter = new Adapter(config) as any;
    adapter.ensureValidToken = vi.fn().mockResolvedValue(undefined);
    adapter.httpClient = { get: vi.fn().mockImplementation(async (_path: string, options: any) => {
      const expand = options?.params?.$expand;
      expect(expand).toMatch(/^singleValueExtendedProperties\(\$filter=id eq '/);
      for (const name of ['alga-calendar-marker-name', 'alga-calendar-marker-note-count', 'alga-calendar-marker-notes-format', 'alga-entry-id']) {
        expect(expand).toContain(`id eq 'String {66f5a359-4659-4830-9070-00047ec6ac6e} Name ${name}'`);
      }
      return { data: { id: 'event', value: [] } };
    }) };
    await adapter.getEvent('event');
    await adapter.listEvents(new Date('2026-09-01'), new Date('2026-10-01'));
    expect(adapter.httpClient.get).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['workspace', MicrosoftCalendarAdapter],
    ['enterprise', EnterpriseMicrosoftCalendarAdapter],
    ['server', LegacyMicrosoftCalendarAdapter],
  ] as const)('%s leaves personal categories untouched and replaces only the category proven to be Alga-owned', async (_name, Adapter) => {
    const adapter = new Adapter(config) as any;
    adapter.ensureValidToken = vi.fn().mockResolvedValue(undefined);
    adapter.httpClient = {
      get: vi.fn().mockImplementation(async (path: string) => path.endsWith('masterCategories')
        ? { data: { value: [{ displayName: 'Alga calendar: New' }] } }
        : { data: {
          categories: ['Alga calendar: Old', 'Alga calendar: Personal', 'User category'],
          singleValueExtendedProperties: [{
            id: 'String {66f5a359-4659-4830-9070-00047ec6ac6e} Name alga-calendar-marker-name',
            value: 'Old',
          }],
        } }),
      post: vi.fn(),
      patch: vi.fn().mockResolvedValue({ data: { id: 'event', body: { content: '' }, categories: [] } }),
    };

    const personal = await mapScheduleEntryToExternalEvent({
      entry_id: 'personal', title: 'Personal', notes: 'Notes', assigned_user_ids: [], work_item_type: 'ad_hoc',
      scheduled_start: new Date('2026-09-28T10:00:00Z'), scheduled_end: new Date('2026-09-28T11:00:00Z'),
    } as unknown as IScheduleEntry, 'microsoft', new Map());
    expect(personal).not.toHaveProperty('categories');
    await adapter.updateEvent('personal-event', personal);
    expect(adapter.httpClient.get).toHaveBeenCalledTimes(0);
    expect(adapter.httpClient.patch.mock.calls[0][1]).not.toHaveProperty('categories');

    const group = await mapScheduleEntryToExternalEvent({
      entry_id: 'group', title: 'Group', notes: 'Notes', assigned_user_ids: [], work_item_type: 'ad_hoc',
      scheduled_start: new Date('2026-09-28T10:00:00Z'), scheduled_end: new Date('2026-09-28T11:00:00Z'),
    } as unknown as IScheduleEntry, 'microsoft', new Map(), 'New');
    await adapter.updateEvent('group-event', group);
    expect(adapter.httpClient.patch.mock.calls[1][1].categories).toEqual([
      'Alga calendar: Personal', 'User category', 'Alga calendar: New',
    ]);
  });

  it.each(['Keep <safe> & notes\n', ''] as const)('sends escaped standalone HTML marker content to Graph for notes %j', async notes => {
    const adapter = new MicrosoftCalendarAdapter(config) as any;
    adapter.ensureValidToken = vi.fn().mockResolvedValue(undefined);
    adapter.httpClient = {
      get: vi.fn().mockResolvedValue({ data: { value: [{ displayName: 'Alga calendar: R&D <Ops>' }], categories: [] } }),
      post: vi.fn(),
      patch: vi.fn().mockResolvedValue({ data: { id: 'event', body: { content: '' }, categories: [] } }),
    };
    const source = {
      entry_id: 'entry-1', title: 'Title', notes, assigned_user_ids: [], work_item_type: 'ad_hoc',
      scheduled_start: new Date('2026-09-28T10:00:00Z'), scheduled_end: new Date('2026-09-28T11:00:00Z'),
    } as unknown as IScheduleEntry;
    const mapped = await mapScheduleEntryToExternalEvent(source, 'microsoft', new Map(), 'R&D <Ops>');
    await adapter.updateEvent('event', mapped);
    const payload = adapter.httpClient.patch.mock.calls[0][1];
    expect(payload.body.contentType).toBe('HTML');
    expect(payload.body.content).toContain('<p>[Alga calendar: R&amp;D &lt;Ops&gt;]</p>');
    expect(payload.body.content).not.toContain('[Alga calendar: R&D <Ops>]');
    if (notes) expect(payload.body.content).toContain('Keep &lt;safe&gt; &amp; notes<br>');
    else expect(payload.body.content).toBe('<p>[Alga calendar: R&amp;D &lt;Ops&gt;]</p>');
    expect(payload.singleValueExtendedProperties).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect.stringContaining('Name alga-calendar-marker-name'), value: 'R&D <Ops>' }),
      expect.objectContaining({ id: expect.stringContaining('Name alga-calendar-marker-note-count'), value: '0' }),
    ]));
  });

  it('reads marker provenance from provider-normalized Outlook HTML for inbound stripping', async () => {
    const adapter = new MicrosoftCalendarAdapter(config) as any;
    adapter.ensureValidToken = vi.fn().mockResolvedValue(undefined);
    adapter.httpClient = { get: vi.fn().mockResolvedValue({ data: {
      id: 'event', subject: 'Title', body: { contentType: 'html', content: '<html><body><p>Keep &amp; preserve</p><p>[Alga calendar: R&amp;D &lt;Ops&gt;]</p></body></html>' },
      start: { dateTime: '2026-09-28T10:00:00', timeZone: 'UTC' },
      end: { dateTime: '2026-09-28T11:00:00', timeZone: 'UTC' },
      singleValueExtendedProperties: [
        { id: 'String {66f5a359-4659-4830-9070-00047ec6ac6e} Name alga-calendar-marker-name', value: 'R&D <Ops>' },
        { id: 'String {66f5a359-4659-4830-9070-00047ec6ac6e} Name alga-calendar-marker-note-count', value: '0' },
        { id: 'String {66f5a359-4659-4830-9070-00047ec6ac6e} Name alga-calendar-marker-notes-format', value: 'text' },
      ],
    } }) };
    const external = await adapter.getEvent('event');
    expect(external.extendedProperties?.private?.['alga-calendar-marker-name']).toBe('R&D <Ops>');
    const inbound = await mapExternalEventToScheduleEntry(external, 'unused-tenant', 'microsoft', new Map());
    expect(inbound.notes).toBe('Keep & preserve');
  });

  it('continues event updates with a reconnect warning when category consent is missing', async () => {
    const adapter = new MicrosoftCalendarAdapter(config) as any;
    adapter.ensureValidToken = vi.fn().mockResolvedValue(undefined);
    adapter.httpClient = {
      get: vi.fn().mockImplementation(async (path: string) => {
        if (path.endsWith('masterCategories')) {
          throw { response: { status: 403, data: { error: { code: 'ErrorAccessDenied' } } } };
        }
        return { data: {
          categories: ['Alga calendar: Old', 'User category'],
          singleValueExtendedProperties: [{
            id: 'String {66f5a359-4659-4830-9070-00047ec6ac6e} Name alga-calendar-marker-name',
            value: 'Old',
          }],
        } };
      }),
      post: vi.fn(),
      patch: vi.fn().mockResolvedValue({ data: {
        id: 'event', subject: 'Title', body: { content: '' },
        start: { dateTime: '2026-09-28T10:00:00', timeZone: 'UTC' },
        end: { dateTime: '2026-09-28T11:00:00', timeZone: 'UTC' },
        categories: ['User category'],
      } }),
    };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const publishStatus = vi.spyOn(CalendarProviderService.prototype, 'updateProviderStatus').mockResolvedValue(undefined);
    try {
      await adapter.updateEvent('event', {
        title: 'Title', description: 'Description',
        categories: ['Alga calendar: On-call'],
      });
      expect(adapter.httpClient.patch).toHaveBeenCalledWith('/me/calendar/events/event', expect.objectContaining({
        subject: 'Title', categories: ['User category'],
      }));
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('Reconnect this Microsoft calendar'));
      expect(publishStatus).toHaveBeenCalledWith('provider', 'tenant', expect.objectContaining({
        status: 'connected', errorMessage: expect.stringContaining('MailboxSettings.ReadWrite'),
      }));
      expect(adapter.getProviderStatusWarning()).toContain('MailboxSettings.ReadWrite');
    } finally {
      warning.mockRestore();
      publishStatus.mockRestore();
    }
  });

  it('does not treat unrelated invalid_grant errors as category-consent failures', async () => {
    const adapter = new MicrosoftCalendarAdapter(config) as any;
    const error = { response: { status: 400, data: { error: { code: 'invalid_grant' } } } };
    adapter.httpClient = { get: vi.fn().mockRejectedValue(error), post: vi.fn() };
    await expect(adapter.ensureMasterCategories(['Alga calendar: On-call'])).rejects.toBe(error);
  });
});
