import { NextResponse } from 'next/server';
import { getSession } from '@alga-psa/auth';
import { isFeatureFlagEnabled } from '@alga-psa/core/features';
import {
  capabilityFeatureFlag,
  capabilityResolverStatus,
  evaluateCapability,
} from '@alga-psa/core/capability';
import { capabilityRouteGuard, notFoundResponse } from '@alga-psa/core/capability/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CAPABILITY = 'co-managed' as const;

/**
 * GET /api/v1/capabilities/co-managed
 *
 * The canonical probe. Reveals only the caller's own tenant's decision and
 * reasons: no query parameters, no body, no other tenant, no resolver SQL, no
 * user identity, no PostHog token, no capability list.
 *
 * Closed (neither admitted nor served) answers with the exact 404 a missing
 * record gets, so the probe cannot be used to discover that the capability
 * exists. A resolver or flag failure fails that branch closed inside the gate
 * and therefore also yields 404, never 500.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  // Client-portal users have no MSP surface to probe.
  if (session.user.user_type === 'client' || !session.user.tenant) {
    return withNoStore(notFoundResponse());
  }
  const tenantId = session.user.tenant;

  let decision;
  try {
    decision = await evaluateCapability(CAPABILITY, tenantId);
  } catch {
    return withNoStore(notFoundResponse());
  }

  if (!decision.admitted && !decision.served) {
    // Same adapter every future REST handler uses; keeps the 404 shape in one place.
    const closed = await capabilityRouteGuard(CAPABILITY, tenantId, 'serves');
    return withNoStore(closed ?? notFoundResponse());
  }

  let flagValue = false;
  try {
    flagValue = await isFeatureFlagEnabled(capabilityFeatureFlag(CAPABILITY), { tenantId });
  } catch {
    flagValue = false;
  }

  return withNoStore(
    NextResponse.json({
      capability: decision.capability,
      tenantId,
      admitted: decision.admitted,
      served: decision.served,
      forced: decision.forced,
      reasons: decision.reasons,
      resolvers: capabilityResolverStatus(CAPABILITY),
      featureFlag: { key: capabilityFeatureFlag(CAPABILITY), value: flagValue },
      evaluatedAt: new Date().toISOString(),
    }),
  );
}

function withNoStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
