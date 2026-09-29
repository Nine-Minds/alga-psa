import { describe, expect, it, vi } from 'vitest';
import type { CalendarProviderConfig } from '@alga-psa/types';
import { MicrosoftCalendarAdapter } from './MicrosoftCalendarAdapter';
import { MicrosoftCalendarAdapter as EnterpriseMicrosoftCalendarAdapter } from '../../../../../../ee/packages/calendar/src/lib/services/calendar/providers/MicrosoftCalendarAdapter';
import { MicrosoftCalendarAdapter as LegacyMicrosoftCalendarAdapter } from '../../../../../../server/src/services/calendar/providers/MicrosoftCalendarAdapter';

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

  it('continues event updates with a reconnect warning when category consent is missing', async () => {
    const adapter = new MicrosoftCalendarAdapter(config) as any;
    adapter.ensureValidToken = vi.fn().mockResolvedValue(undefined);
    adapter.httpClient = {
      get: vi.fn().mockImplementation(async (path: string) => {
        if (path.endsWith('masterCategories')) {
          throw { response: { status: 403, data: { error: { code: 'ErrorAccessDenied' } } } };
        }
        return { data: { categories: ['Alga calendar: Old', 'User category'] } };
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
    try {
      await adapter.updateEvent('event', {
        title: 'Title', description: 'Description',
        categories: ['Alga calendar: On-call'],
      });
      expect(adapter.httpClient.patch).toHaveBeenCalledWith('/me/calendar/events/event', expect.objectContaining({
        subject: 'Title', categories: ['User category'],
      }));
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('Reconnect the Microsoft calendar'));
    } finally {
      warning.mockRestore();
    }
  });

  it('does not treat unrelated invalid_grant errors as category-consent failures', async () => {
    const adapter = new MicrosoftCalendarAdapter(config) as any;
    const error = { response: { status: 400, data: { error: { code: 'invalid_grant' } } } };
    adapter.httpClient = { get: vi.fn().mockRejectedValue(error), post: vi.fn() };
    await expect(adapter.ensureMasterCategories(['Alga calendar: On-call'])).rejects.toBe(error);
  });
});
