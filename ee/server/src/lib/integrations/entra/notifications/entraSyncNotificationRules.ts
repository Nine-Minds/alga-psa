/**
 * Telling someone when the sync needs a human.
 *
 * The review queue was a screen nobody was told to visit, and a sync that
 * failed every night failed silently — the only way to find out was to open
 * the Identity screen and look. These notifications exist so the two states
 * that need a person reach one.
 *
 * Deliberately conservative about volume: a repeated-failure alert fires on
 * the *second* consecutive failure, not the first (one failed run is often a
 * transient Graph error that fixes itself), and the per-run digest is off
 * unless a tenant asks for it.
 */

export const ENTRA_CONSOLE_LINK = '/msp/settings/integrations/entra';
export const ENTRA_REVIEW_QUEUE_LINK = `${ENTRA_CONSOLE_LINK}?tab=review-queue`;
export const ENTRA_HISTORY_LINK = `${ENTRA_CONSOLE_LINK}?tab=history`;

export interface EntraNotificationConfig {
  /** Every completed run produces a summary. Off unless asked for. */
  postRunDigest: boolean;
  /** Two consecutive failed runs. On by default: silence here is a defect. */
  repeatedFailures: boolean;
  /** New identities landed in the review queue and need a decision. */
  reviewQueueArrivals: boolean;
}

export const DEFAULT_ENTRA_NOTIFICATION_CONFIG: EntraNotificationConfig = {
  postRunDigest: false,
  repeatedFailures: true,
  reviewQueueArrivals: true,
};

export function normalizeEntraNotificationConfig(value: unknown): EntraNotificationConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_ENTRA_NOTIFICATION_CONFIG };
  }

  const source = value as Record<string, unknown>;
  const read = (key: keyof EntraNotificationConfig): boolean => {
    const raw = source[key];
    if (raw === undefined || raw === null) {
      return DEFAULT_ENTRA_NOTIFICATION_CONFIG[key];
    }
    return raw === true || raw === 'true' || raw === 1 || raw === '1';
  };

  return {
    postRunDigest: read('postRunDigest'),
    repeatedFailures: read('repeatedFailures'),
    reviewQueueArrivals: read('reviewQueueArrivals'),
  };
}

export type EntraNotificationKind = 'run-digest' | 'repeated-failure' | 'review-queue';

export interface EntraNotification {
  kind: EntraNotificationKind;
  title: string;
  message: string;
  link: string;
}

export interface DecideEntraRunNotificationsInput {
  status: 'completed' | 'partial' | 'failed' | string;
  summary: {
    totalTenants: number;
    succeededTenants: number;
    failedTenants: number;
    created: number;
    linked: number;
    updated: number;
    ambiguous: number;
    inactivated: number;
  };
  /** Statuses of previous real runs, newest first. */
  previousRunStatuses: string[];
  config: EntraNotificationConfig;
}

const FAILED_STATUSES = new Set(['failed', 'partial']);

/**
 * What this run's outcome should tell someone. Pure: the caller decides how to
 * deliver, and tests can assert the rules without a database.
 */
export function decideEntraRunNotifications(
  input: DecideEntraRunNotificationsInput
): EntraNotification[] {
  const notifications: EntraNotification[] = [];
  const failed = FAILED_STATUSES.has(input.status);

  if (input.config.repeatedFailures && failed) {
    const previousFailed = FAILED_STATUSES.has(input.previousRunStatuses[0] || '');
    if (previousFailed) {
      notifications.push({
        kind: 'repeated-failure',
        title: 'Microsoft Entra sync is failing repeatedly',
        message:
          `The last two syncs did not complete (${input.summary.failedTenants} of `
          + `${input.summary.totalTenants} clients failed in the latest run). Contacts are no longer `
          + 'being kept in step.',
        link: ENTRA_HISTORY_LINK,
      });
    }
  }

  if (input.config.reviewQueueArrivals && input.summary.ambiguous > 0) {
    notifications.push({
      kind: 'review-queue',
      title: 'Microsoft Entra needs a decision',
      message:
        `${input.summary.ambiguous} identities matched more than one contact, so the sync did not `
        + 'guess. They are waiting in the review queue.',
      link: ENTRA_REVIEW_QUEUE_LINK,
    });
  }

  if (input.config.postRunDigest && !failed) {
    notifications.push({
      kind: 'run-digest',
      title: 'Microsoft Entra sync finished',
      message:
        `${input.summary.succeededTenants} of ${input.summary.totalTenants} clients synced · `
        + `${input.summary.created} contacts created, ${input.summary.linked} linked, `
        + `${input.summary.updated} updated, ${input.summary.inactivated} marked inactive.`,
      link: ENTRA_HISTORY_LINK,
    });
  }

  return notifications;
}
