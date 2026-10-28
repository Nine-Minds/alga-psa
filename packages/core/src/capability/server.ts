/**
 * @alga-psa/core/capability/server — Next-bound capability adapters.
 *
 * "Closed" has a different native shape per runtime, which is why adapters
 * exist instead of callers branching on the gate themselves:
 *   1. server action -> CapabilityUnavailableError
 *   2. REST          -> the exact existing NotFoundError 404 body
 *   3. RSC page      -> notFound()
 * The Next-free adapters (jobs, subscribers, Temporal) live in
 * `@alga-psa/core/capability` and `@alga-psa/jobs`. Workers must never import
 * this module: it pulls in `next`.
 */

// LEVERAGE: pattern capability-closed-shape — six adapters exist because "closed" has six native shapes; if a seventh runtime appears, extend the table rather than calling the gate directly.
// LEVERAGE: friction next-in-core-subpath — @alga-psa/core now has a Next-bound subpath solely for adapters; if a third Next-bound helper appears, the adapter layer belongs in its own package.

import { NextResponse } from 'next/server';
import { notFound } from 'next/navigation';
import { admits, serves, type CapabilityKey, type CapabilityMode } from '../lib/capability';

export class CapabilityUnavailableError extends Error {
  readonly code = 'CAPABILITY_UNAVAILABLE';

  constructor() {
    super('This feature is not available.');
    this.name = 'CapabilityUnavailableError';
  }
}

async function isOpen(capability: CapabilityKey, tenantId: string, mode: CapabilityMode): Promise<boolean> {
  const d = mode === 'admits' ? await admits(capability, tenantId) : await serves(capability, tenantId);
  return mode === 'admits' ? d.admitted : d.served;
}

/**
 * Adapter 1. Call as the FIRST statement of the action body, after `withAuth`
 * establishes `ctx.tenant`, so the tenant can never arrive from an argument.
 */
export async function requireCapabilityForAction(
  capability: CapabilityKey,
  tenantId: string,
  mode: CapabilityMode = 'admits',
): Promise<void> {
  if (!(await isOpen(capability, tenantId, mode))) throw new CapabilityUnavailableError();
}

/**
 * Adapter 2. Returns (rather than throws) because bare route handlers never
 * enter a controller error path. The body is byte-identical to
 * `handleApiError(new NotFoundError())` in apiMiddleware.ts (asserted by the
 * adapter contract test), so a closed capability is indistinguishable from a
 * missing record.
 */
export async function capabilityRouteGuard(
  capability: CapabilityKey,
  tenantId: string,
  mode: CapabilityMode = 'serves',
): Promise<NextResponse | null> {
  if (await isOpen(capability, tenantId, mode)) return null;
  return notFoundResponse();
}

export function notFoundResponse(): NextResponse {
  return NextResponse.json(
    { error: { code: 'NOT_FOUND', message: 'Resource not found' } },
    { status: 404 },
  );
}

/**
 * Adapter 3. Run after tenant resolution and before the first data fetch so
 * the 404 costs zero queries.
 */
export async function requireCapabilityForPage(
  capability: CapabilityKey,
  tenantId: string,
  mode: CapabilityMode = 'serves',
): Promise<void> {
  if (!(await isOpen(capability, tenantId, mode))) notFound();
}
