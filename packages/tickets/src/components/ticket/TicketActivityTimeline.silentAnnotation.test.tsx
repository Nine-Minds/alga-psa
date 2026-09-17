import { describe, expect, it } from 'vitest';
import type { TicketActivityRow, TicketTimelineEntry } from '@alga-psa/shared/lib/ticketActivity';

import { formatEntries } from './TicketActivityTimeline';

function makeActivity(overrides: Partial<TicketActivityRow>): TicketActivityRow {
  return {
    tenant: 'tenant-1',
    audit_id: 'audit-1',
    ticket_id: 'ticket-1',
    event_type: 'TICKET_UPDATED',
    entity_type: 'ticket',
    entity_id: 'ticket-1',
    actor_type: 'user',
    actor_user_id: 'user-1',
    actor_contact_id: null,
    actor_display_name: 'Pat Agent',
    source: 'ui',
    occurred_at: '2026-07-09T12:00:00.000Z',
    changes: {},
    details: {},
    created_at: '2026-07-09T12:00:00.000Z',
    ...overrides,
  };
}

function activityEntry(activity: TicketActivityRow): TicketTimelineEntry {
  return {
    type: 'activity',
    occurredAt: activity.occurred_at,
    sortId: activity.audit_id,
    activity,
  };
}

describe('TicketActivityTimeline silent annotations', () => {
  it('annotates contact-suppressed update rows', () => {
    const [entry] = formatEntries([
      activityEntry(
        makeActivity({
          details: {
            notification_suppression: {
              suppress_contact_notifications: true,
              suppress_internal_notifications: false,
            },
          },
        })
      ),
    ]);

    expect(entry.title).toBe('Pat Agent updated the ticket');
    expect(entry.annotation).toBe('silent — contact not notified');
  });

  it('annotates fully-suppressed close rows', () => {
    const [entry] = formatEntries([
      activityEntry(
        makeActivity({
          event_type: 'TICKET_CLOSED',
          details: {
            notification_suppression: {
              suppress_contact_notifications: true,
              suppress_internal_notifications: true,
            },
          },
        })
      ),
    ]);

    expect(entry.title).toBe('Pat Agent closed the ticket');
    expect(entry.annotation).toBe('silent — no notifications');
  });

  it('shows the visibility transition with localized labels in internal history', () => {
    const [entry] = formatEntries([activityEntry(makeActivity({
      event_type: 'TICKET_EXTERNAL_LINK_UPDATED', source: 'external_link',
      changes: { portal_visible: { old: false, new: true } },
      details: { system_label: 'Vendor', external_id: '42' },
    }))], (visible) => visible ? 'Geteilt' : 'Intern');
    expect(entry.subtitle).toBe('Intern → Geteilt');
    expect(entry.actor).toBe('Pat Agent');
  });

  it('does not annotate normal activity rows', () => {
    const [entry] = formatEntries([
      activityEntry(makeActivity({ details: {} })),
    ]);

    expect(entry.annotation).toBeUndefined();
  });
});
