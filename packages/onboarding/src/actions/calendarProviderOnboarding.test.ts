import { describe, expect, it } from 'vitest';
import {
  summarizeCalendarProviders,
  type CalendarProviderRow,
} from './calendarProviderOnboarding';

const createProviderRow = (
  overrides: Partial<CalendarProviderRow> = {},
): CalendarProviderRow => ({
  id: 'provider-1',
  tenant: 'tenant-1',
  user_id: 'user-1',
  provider_type: 'microsoft',
  provider_name: 'Outlook',
  calendar_id: 'calendar-1',
  is_active: true,
  sync_direction: 'bidirectional',
  status: 'connected',
  last_sync_at: null,
  error_message: null,
  vendor_config: {},
  created_at: '2026-08-21T19:13:00.000Z',
  updated_at: '2026-08-21T19:13:00.000Z',
  ...overrides,
});

describe('summarizeCalendarProviders', () => {
  it('recognizes an active connected database row', () => {
    const summary = summarizeCalendarProviders([createProviderRow()]);

    expect(summary.connectionStatus).toBe('complete');
    expect(summary.lastUpdated).toBe('2026-08-21T19:13:00.000Z');
    expect(summary.providers).toEqual([
      { id: 'provider-1', name: 'Outlook', status: 'connected' },
    ]);
  });

  it('does not recognize an inactive connected database row', () => {
    const summary = summarizeCalendarProviders([
      createProviderRow({ is_active: false }),
    ]);

    expect(summary.connectionStatus).toBe('in_progress');
    expect(summary.blocker).toBeNull();
  });

  it('uses database provider fields for an error row', () => {
    const summary = summarizeCalendarProviders([
      createProviderRow({ status: 'error' }),
    ]);

    expect(summary.connectionStatus).toBe('blocked');
    expect(summary.blocker).toBe(
      'Outlook requires attention before syncing can resume.',
    );
    expect(summary.blockerValues).toEqual({ provider: 'Outlook' });
    expect(summary.providers).toEqual([
      { id: 'provider-1', name: 'Outlook', status: 'error' },
    ]);
  });
});
