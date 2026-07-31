import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENTRA_NOTIFICATION_CONFIG,
  decideEntraRunNotifications,
  normalizeEntraNotificationConfig,
} from '@ee/lib/integrations/entra/notifications/entraSyncNotificationRules';

const summary = (overrides: Partial<Parameters<typeof decideEntraRunNotifications>[0]['summary']> = {}) => ({
  totalTenants: 4,
  succeededTenants: 4,
  failedTenants: 0,
  created: 2,
  linked: 3,
  updated: 1,
  ambiguous: 0,
  inactivated: 0,
  ...overrides,
});

describe('normalizeEntraNotificationConfig', () => {
  it('defaults to telling someone about failures and decisions, but not every run', () => {
    expect(normalizeEntraNotificationConfig(null)).toEqual({
      postRunDigest: false,
      repeatedFailures: true,
      reviewQueueArrivals: true,
    });
    expect(DEFAULT_ENTRA_NOTIFICATION_CONFIG.repeatedFailures).toBe(true);
  });

  it('keeps a default when the stored config predates the setting', () => {
    // An empty object is what the migration writes; it must not read as "all off".
    expect(normalizeEntraNotificationConfig({})).toEqual(DEFAULT_ENTRA_NOTIFICATION_CONFIG);
    expect(normalizeEntraNotificationConfig({ repeatedFailures: false })).toMatchObject({
      repeatedFailures: false,
      reviewQueueArrivals: true,
    });
  });
});

describe('decideEntraRunNotifications', () => {
  const config = DEFAULT_ENTRA_NOTIFICATION_CONFIG;

  it('says nothing about a clean run when the digest is off', () => {
    expect(
      decideEntraRunNotifications({
        status: 'completed',
        summary: summary(),
        previousRunStatuses: ['completed'],
        config,
      })
    ).toEqual([]);
  });

  it('stays quiet on a first failure, which is usually transient', () => {
    const notifications = decideEntraRunNotifications({
      status: 'failed',
      summary: summary({ failedTenants: 4, succeededTenants: 0 }),
      previousRunStatuses: ['completed'],
      config,
    });

    expect(notifications).toEqual([]);
  });

  it('alerts on the second consecutive failure', () => {
    const notifications = decideEntraRunNotifications({
      status: 'failed',
      summary: summary({ failedTenants: 4, succeededTenants: 0 }),
      previousRunStatuses: ['failed', 'completed'],
      config,
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0].kind).toBe('repeated-failure');
    expect(notifications[0].link).toContain('tab=history');
    expect(notifications[0].message).toContain('no longer');
  });

  it('treats a partial run as a failure for this purpose', () => {
    const notifications = decideEntraRunNotifications({
      status: 'partial',
      summary: summary({ failedTenants: 1, succeededTenants: 3 }),
      previousRunStatuses: ['partial'],
      config,
    });

    expect(notifications.map((entry) => entry.kind)).toContain('repeated-failure');
  });

  it('points at the review queue when identities are waiting for a decision', () => {
    const notifications = decideEntraRunNotifications({
      status: 'completed',
      summary: summary({ ambiguous: 3 }),
      previousRunStatuses: [],
      config,
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0].kind).toBe('review-queue');
    expect(notifications[0].link).toContain('tab=review-queue');
    expect(notifications[0].message).toContain('3 identities');
  });

  it('sends the digest only when asked, and only for a run that worked', () => {
    const withDigest = { ...config, postRunDigest: true };

    const good = decideEntraRunNotifications({
      status: 'completed',
      summary: summary(),
      previousRunStatuses: [],
      config: withDigest,
    });
    expect(good.map((entry) => entry.kind)).toEqual(['run-digest']);
    expect(good[0].message).toContain('2 contacts created');

    const bad = decideEntraRunNotifications({
      status: 'failed',
      summary: summary({ failedTenants: 4 }),
      previousRunStatuses: [],
      config: withDigest,
    });
    // A failure is reported as a failure, not dressed up as a digest.
    expect(bad.map((entry) => entry.kind)).not.toContain('run-digest');
  });

  it('honours every switch being off', () => {
    expect(
      decideEntraRunNotifications({
        status: 'failed',
        summary: summary({ ambiguous: 5, failedTenants: 4 }),
        previousRunStatuses: ['failed'],
        config: { postRunDigest: false, repeatedFailures: false, reviewQueueArrivals: false },
      })
    ).toEqual([]);
  });
});
