import { describe, expect, it } from 'vitest';

import { ticketEmailSubscriberTestHarness } from '../ticketEmailSubscriber';

const {
  resolveTicketNotificationSuppression,
  resolveAccumulatedTicketNotificationSuppression,
  shouldSendContactFacingTicketEmail,
  shouldSendInternalTicketEmail,
  shouldSendTicketWatcherEmail,
  shouldSendTicketClosedWatcherEmail,
} = ticketEmailSubscriberTestHarness;

describe('ticketEmailSubscriber suppression policy', () => {
  it('T017: contact suppression disables primary contact and bundle child requester close emails', () => {
    const suppression = resolveTicketNotificationSuppression({
      suppressContactNotifications: true,
    });

    expect(shouldSendContactFacingTicketEmail(suppression)).toBe(false);
  });

  it('T018: contact-only suppression still allows assignee, additional-agent, and internal-watcher close emails', () => {
    const suppression = resolveTicketNotificationSuppression({
      suppressContactNotifications: true,
    });

    expect(shouldSendInternalTicketEmail(suppression)).toBe(true);
    expect(shouldSendTicketClosedWatcherEmail(suppression, true)).toBe(true);
  });

  it('T019: contact suppression disables external-watcher close emails', () => {
    const suppression = resolveTicketNotificationSuppression({
      suppressContactNotifications: true,
    });

    expect(shouldSendTicketClosedWatcherEmail(suppression, false)).toBe(false);
  });

  it('T020: full suppression disables all ticket closed emails', () => {
    const suppression = resolveTicketNotificationSuppression({
      suppressContactNotifications: true,
      suppressInternalNotifications: true,
    });

    expect(shouldSendContactFacingTicketEmail(suppression)).toBe(false);
    expect(shouldSendInternalTicketEmail(suppression)).toBe(false);
    expect(shouldSendTicketClosedWatcherEmail(suppression, true)).toBe(false);
    expect(shouldSendTicketClosedWatcherEmail(suppression, false)).toBe(false);
  });

  it('T025: normal close leaves all close recipient classes enabled', () => {
    const suppression = resolveTicketNotificationSuppression({});

    expect(shouldSendContactFacingTicketEmail(suppression)).toBe(true);
    expect(shouldSendInternalTicketEmail(suppression)).toBe(true);
    expect(shouldSendTicketClosedWatcherEmail(suppression, true)).toBe(true);
    expect(shouldSendTicketClosedWatcherEmail(suppression, false)).toBe(true);
  });

  it('T026: ticket update contact suppression disables the client update email', () => {
    const suppression = resolveTicketNotificationSuppression({
      suppressContactNotifications: true,
    });

    expect(shouldSendContactFacingTicketEmail(suppression)).toBe(false);
  });

  it('T027: accumulated ticket updates preserve contact suppression through the flush policy', () => {
    const suppression = resolveAccumulatedTicketNotificationSuppression([
      {
        timestamp: '2026-07-09T12:00:00.000Z',
        userId: 'user-1',
        eventType: 'TICKET_UPDATED',
        payload: {
          suppressContactNotifications: true,
          suppressInternalNotifications: false,
        },
      },
      {
        timestamp: '2026-07-09T12:00:01.000Z',
        userId: 'user-2',
        eventType: 'TICKET_UPDATED',
        payload: {},
      },
    ]);

    expect(shouldSendContactFacingTicketEmail(suppression)).toBe(false);
    expect(shouldSendInternalTicketEmail(suppression)).toBe(true);
  });

  it('T028: update watcher sends keep internal recipients on contact-only silence and drop all recipients on full silence', () => {
    const contactOnly = resolveTicketNotificationSuppression({
      suppressContactNotifications: true,
    });
    const full = resolveTicketNotificationSuppression({
      suppressContactNotifications: true,
      suppressInternalNotifications: true,
    });

    expect(shouldSendTicketWatcherEmail(contactOnly, false)).toBe(false);
    expect(shouldSendTicketWatcherEmail(contactOnly, true)).toBe(true);
    expect(shouldSendTicketWatcherEmail(full, false)).toBe(false);
    expect(shouldSendTicketWatcherEmail(full, true)).toBe(false);
  });

  it('T030: assignment suppression gates client assignment emails separately from internal assignment emails', () => {
    const contactOnly = resolveTicketNotificationSuppression({
      suppressContactNotifications: true,
    });
    const full = resolveTicketNotificationSuppression({
      suppressContactNotifications: true,
      suppressInternalNotifications: true,
    });

    expect(shouldSendContactFacingTicketEmail(contactOnly)).toBe(false);
    expect(shouldSendInternalTicketEmail(contactOnly)).toBe(true);
    expect(shouldSendContactFacingTicketEmail(full)).toBe(false);
    expect(shouldSendInternalTicketEmail(full)).toBe(false);
  });
});
