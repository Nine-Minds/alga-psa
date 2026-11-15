'use client';

import { v4 as uuidv4 } from 'uuid';

/**
 * Mint a client-side identifier for a co-managed command.
 *
 * Every mutating co-managed panel needs one of these: an `operationId` that makes
 * the command idempotent across retries, or an `attachmentId`/`grantId` chosen
 * before the request leaves the browser.
 *
 * It exists because `crypto.randomUUID` is only defined in a **secure context**
 * (HTTPS, or a `localhost` origin). A reviewer or a self-hosted operator reaching
 * the app over plain HTTP on a LAN or tailnet address gets `undefined`, and every
 * one of those panels threw `TypeError: crypto.randomUUID is not a function`.
 * The throw happens while the request object is being built — before the
 * `try` that would have surfaced it — so the action was abandoned as an
 * unhandled rejection with no error shown to the user. Escalation, hand-back,
 * assignment, delegation, departure and purchase all failed silently.
 *
 * `uuid`'s v4 is built on `crypto.getRandomValues`, which is available in every
 * context, so this is one code path rather than an environment-dependent
 * fallback that would be exercised only off-localhost.
 */
export function newCoManagedOperationId(): string {
  return uuidv4();
}
