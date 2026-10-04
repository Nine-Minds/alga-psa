/**
 * Activity proxies shared by the Appliance Console workflows.
 *
 * C4 and Stripe calls retry 5 times (transient network faults; 4xx are marked
 * non-retryable by the activities). Email retries 3 times but never fails the
 * workflow: deliverApplianceEmail reports `sent: false` instead of throwing.
 */

import { proxyActivities, ApplicationFailure } from '@temporalio/workflow';
import type * as activities from '../../activities';

export const c4 = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 5, backoffCoefficient: 2, initialInterval: '2s', maximumInterval: '30s' },
});

export const stripe = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 5, backoffCoefficient: 2, initialInterval: '2s', maximumInterval: '30s' },
});

export const email = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 3 },
});

/** Fail the workflow with an operator-readable message; no retry. */
export function fail(message: string, type: string): never {
  throw ApplicationFailure.nonRetryable(message, type);
}

/** Comp entitlements carry a synthetic id; nothing in Stripe to touch. */
export function isCompSubscriptionId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('comp:');
}
