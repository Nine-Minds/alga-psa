import { describe, expect, it } from 'vitest';

import {
  mergeTimelineEntries,
  type TicketTimelineEntry,
} from '../readTicketActivity';

describe('mergeTimelineEntries', () => {
  const entries: TicketTimelineEntry[] = [
    {
      type: 'alert',
      occurredAt: '2026-07-03T10:00:00.000Z',
      sortId: 'c-alert',
      alert: {
        alert_id: 'c-alert',
        severity: 'critical',
        message: 'CPU high',
        device_name: 'server-1',
        occurrence_count: 2,
        triggered_at: '2026-07-03T10:00:00.000Z',
        resolved_at: null,
        alert_class: 'condition',
        source_type: 'rmm',
      },
    },
    {
      type: 'comment',
      occurredAt: '2026-07-03T11:00:00.000Z',
      sortId: 'b-comment',
      comment: { comment_id: 'b-comment' },
    },
    {
      type: 'activity',
      occurredAt: '2026-07-03T10:00:00.000Z',
      sortId: 'a-activity',
      activity: {
        tenant: 'tenant-1',
        audit_id: 'a-activity',
        ticket_id: 'ticket-1',
        event_type: 'TICKET_UPDATED',
        entity_type: 'ticket',
        entity_id: 'ticket-1',
        actor_type: 'user',
        actor_user_id: 'user-1',
        actor_contact_id: null,
        actor_display_name: 'Ada Lovelace',
        source: 'ui',
        occurred_at: '2026-07-03T10:00:00.000Z',
        changes: {},
        details: {},
        created_at: '2026-07-03T10:00:00.000Z',
      },
    },
    {
      type: 'time_entry',
      occurredAt: '2026-07-03T09:00:00.000Z',
      sortId: 'd-time',
      timeEntry: {
        entry_id: 'd-time',
        user_id: 'user-1',
        user_display_name: 'Ada Lovelace',
        start_time: '2026-07-03T09:00:00.000Z',
        end_time: '2026-07-03T09:30:00.000Z',
        billable_duration: 30,
        notes: 'Worked the ticket',
        work_date: '2026-07-03',
      },
    },
  ];

  it('sorts chronologically ascending and breaks timestamp ties by sortId ascending', () => {
    expect(mergeTimelineEntries(entries, 'asc').map((entry) => `${entry.type}:${entry.sortId}`)).toEqual([
      'time_entry:d-time',
      'activity:a-activity',
      'alert:c-alert',
      'comment:b-comment',
    ]);
  });

  it('sorts chronologically descending and breaks timestamp ties by sortId descending', () => {
    expect(mergeTimelineEntries(entries, 'desc').map((entry) => `${entry.type}:${entry.sortId}`)).toEqual([
      'comment:b-comment',
      'alert:c-alert',
      'activity:a-activity',
      'time_entry:d-time',
    ]);
  });

  it('does not mutate the provided entry array', () => {
    const originalOrder = entries.map((entry) => entry.sortId);
    mergeTimelineEntries(entries, 'asc');
    expect(entries.map((entry) => entry.sortId)).toEqual(originalOrder);
  });
});
