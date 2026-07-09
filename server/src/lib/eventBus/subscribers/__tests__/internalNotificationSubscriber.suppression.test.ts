import { describe, expect, it } from 'vitest';

import { internalNotificationSubscriberTestHarness } from '../internalNotificationSubscriber';

const {
  resolveTicketNotificationSuppression,
  shouldCreateContactPortalTicketNotification,
  shouldCreateStaffTicketNotification,
} = internalNotificationSubscriberTestHarness;

describe('internalNotificationSubscriber ticket suppression policy', () => {
  it('T022: contact suppression disables client portal close notifications', () => {
    const suppression = resolveTicketNotificationSuppression({
      suppressContactNotifications: true,
    });

    expect(shouldCreateContactPortalTicketNotification(suppression)).toBe(false);
  });

  it('T023: internal suppression disables staff notifications, while contact-only keeps them', () => {
    const contactOnly = resolveTicketNotificationSuppression({
      suppressContactNotifications: true,
    });
    const full = resolveTicketNotificationSuppression({
      suppressContactNotifications: true,
      suppressInternalNotifications: true,
    });

    expect(shouldCreateStaffTicketNotification(contactOnly)).toBe(true);
    expect(shouldCreateStaffTicketNotification(full)).toBe(false);
  });

  it('T031: update notifications use the same contact and internal gating policy', () => {
    const contactOnly = resolveTicketNotificationSuppression({
      suppressContactNotifications: true,
    });
    const full = resolveTicketNotificationSuppression({
      suppressContactNotifications: true,
      suppressInternalNotifications: true,
    });

    expect(shouldCreateContactPortalTicketNotification(contactOnly)).toBe(false);
    expect(shouldCreateStaffTicketNotification(contactOnly)).toBe(true);
    expect(shouldCreateStaffTicketNotification(full)).toBe(false);
  });
});
