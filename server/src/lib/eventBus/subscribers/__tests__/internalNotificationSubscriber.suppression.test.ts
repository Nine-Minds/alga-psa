import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { internalNotificationSubscriberTestHarness } from '../internalNotificationSubscriber';

const {
  resolveTicketNotificationSuppression,
  shouldCreateContactPortalTicketNotification,
  shouldCreateStaffTicketNotification,
  shouldCreateTicketCommentNotification,
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

  it('handleTicketAssigned wires both suppression gates (assignment must honor silent updates)', () => {
    const source = readFileSync(resolve(__dirname, '../internalNotificationSubscriber.ts'), 'utf8');
    const section = source.slice(
      source.indexOf('async function handleTicketAssigned'),
      source.indexOf('async function handleTicketAdditionalAgentAssigned'),
    );

    expect(section).toContain('resolveTicketNotificationSuppression(event.payload)');
    expect(section).toContain('shouldCreateStaffTicketNotification(suppression)');
    expect(section).toContain('shouldCreateContactPortalTicketNotification(suppression)');
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

  it('suppresses closing-resolution comment notifications for the selected recipient classes', () => {
    const contactOnly = resolveTicketNotificationSuppression({
      suppressContactNotifications: true,
    });
    const full = resolveTicketNotificationSuppression({
      suppressContactNotifications: true,
      suppressInternalNotifications: true,
    });

    expect(shouldCreateTicketCommentNotification(contactOnly, 'contact')).toBe(false);
    expect(shouldCreateTicketCommentNotification(contactOnly, 'internal')).toBe(true);
    expect(shouldCreateTicketCommentNotification(full, 'contact')).toBe(false);
    expect(shouldCreateTicketCommentNotification(full, 'internal')).toBe(false);
  });
});
