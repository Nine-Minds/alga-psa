/**
 * Registration point for inbound auth-pause admin notifications.
 *
 * `shared/` cannot depend on `@alga-psa/notifications` (that would create a
 * package cycle), so the lifecycle service exposes this tiny dispatch hook.
 * The server process registers the real implementation (which creates
 * `system-announcement` internal notifications for active tenant admins) at
 * startup; other runtimes simply have no notifier and rely on the persistent
 * settings banner as the durable fallback.
 *
 * Delivery is best-effort and must never roll back the pause itself.
 */

export interface InboundAuthPauseNotificationParams {
  tenant: string;
  providerId: string;
  providerName: string;
  mailbox: string;
  providerType: 'microsoft' | 'google' | 'imap';
  /** Safe, sanitized reason code (e.g. `microsoft:invalid_grant`). Never raw error text. */
  authFailureCode: string;
  pausedAt: string;
}

export type InboundAuthPauseNotifier = (
  params: InboundAuthPauseNotificationParams
) => Promise<void>;

let registeredNotifier: InboundAuthPauseNotifier | null = null;

export function registerInboundAuthPauseNotifier(notifier: InboundAuthPauseNotifier): void {
  registeredNotifier = notifier;
}

export function clearInboundAuthPauseNotifier(): void {
  registeredNotifier = null;
}

/**
 * Whether a notifier implementation is registered in this process. Every
 * runtime that can trigger the auto-pause (Next server, bin consumer,
 * email-service container, Temporal worker) must register one at startup —
 * a silent pause with no admin notification and no durable signal is the
 * failure mode this feature exists to prevent.
 */
export function isInboundAuthPauseNotifierRegistered(): boolean {
  return registeredNotifier !== null;
}

/**
 * Startup guard for pause-triggering entrypoints: logs a loud error (never
 * throws — startup must not depend on the notifier) when no notifier is
 * registered, so a mis-wired deployment surfaces immediately in logs.
 */
export function assertInboundAuthPauseNotifierRegistered(entrypoint: string): boolean {
  if (isInboundAuthPauseNotifierRegistered()) {
    return true;
  }
  console.error('[EmailProviderLifecycle] NO inbound auth-pause notifier registered; auto-pauses would be silent', {
    event: 'inbound_auth_pause_notifier_missing',
    entrypoint,
    remediation: 'Register a notifier (direct or event-publisher) at startup of every pause-triggering runtime.',
  });
  return false;
}

export async function dispatchInboundAuthPauseNotification(
  params: InboundAuthPauseNotificationParams
): Promise<void> {
  if (!registeredNotifier) {
    console.info('[EmailProviderLifecycle] no inbound auth-pause notifier registered', {
      tenant: params.tenant,
      providerId: params.providerId,
      authFailureCode: params.authFailureCode,
    });
    return;
  }

  try {
    await registeredNotifier(params);
  } catch (error) {
    console.warn('[EmailProviderLifecycle] inbound auth-pause notification delivery failed', {
      tenant: params.tenant,
      providerId: params.providerId,
      authFailureCode: params.authFailureCode,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
