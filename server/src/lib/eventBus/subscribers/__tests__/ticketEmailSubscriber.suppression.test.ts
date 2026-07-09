import { describe, expect, it } from 'vitest';

import { ticketEmailSubscriberTestHarness } from '../ticketEmailSubscriber';

const {
  resolveTicketNotificationSuppression,
  shouldSendContactFacingTicketEmail,
  shouldSendInternalTicketEmail,
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

  it('normal close leaves all close recipient classes enabled', () => {
    const suppression = resolveTicketNotificationSuppression({});

    expect(shouldSendContactFacingTicketEmail(suppression)).toBe(true);
    expect(shouldSendInternalTicketEmail(suppression)).toBe(true);
    expect(shouldSendTicketClosedWatcherEmail(suppression, true)).toBe(true);
    expect(shouldSendTicketClosedWatcherEmail(suppression, false)).toBe(true);
  });
});
