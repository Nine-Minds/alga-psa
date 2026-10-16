// Dependency-free so StripeService can import it statically, even when the lifecycle module's own import fails.
/**
 * Wraps a failure while mirroring an appliance lifecycle event, so the webhook
 * route can answer 5xx and let Stripe re-deliver. Recognise it structurally
 * (`name` / `retryable`), not via instanceof: the route lives in another package
 * and loads StripeService through a dynamic import.
 */
export const APPLIANCE_LIFECYCLE_RETRYABLE_ERROR_NAME = 'ApplianceLifecycleRetryableError';

export class ApplianceLifecycleRetryableError extends Error {
  readonly retryable = true as const;
  readonly cause: unknown;
  constructor(message: string, cause: unknown) {
    super(message);
    this.name = APPLIANCE_LIFECYCLE_RETRYABLE_ERROR_NAME;
    this.cause = cause;
  }
}
