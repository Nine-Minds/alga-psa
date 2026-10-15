/**
 * Appliance Console API — hard-revoke one appliance credential.
 *
 * POST /api/v1/appliance-installs/:tenantId/appliances/:applianceId/revoke { reason }
 *
 * The entitlement stays active; that box's next check-in is refused and the
 * customer re-activates with a fresh activation code. Master tenant only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApplianceTrigger } from '@ee/lib/applianceConsole/triggerRoute';
import { parseRevokeAppliance } from '@ee/lib/applianceConsole/actionInputs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ tenantId: string; applianceId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { tenantId, applianceId } = await context.params;
  return handleApplianceTrigger(
    {
      action: 'revoke-appliance',
      eventType: 'appliance.revoke_appliance',
      parse: (body, id, base) => parseRevokeAppliance(body, id!, applianceId, base),
    },
    request,
    tenantId,
  );
}
