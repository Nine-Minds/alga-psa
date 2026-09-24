/**
 * Appliance Console API — change seats and/or tier, comp (C4 only) or billed (Stripe first).
 *
 * POST /api/v1/appliance-installs/:tenantId/entitlement
 *
 * Master tenant only. Writes a pending audit row, starts the
 * `entitlement` workflow, returns { workflow_id, audit_log_id } (202).
 */

import { createTenantActionRoute } from '@ee/lib/applianceConsole/triggerRoute';
import { parseChangeEntitlement } from '@ee/lib/applianceConsole/actionInputs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createTenantActionRoute({
  action: 'entitlement',
  eventType: 'appliance.entitlement',
  parse: (body, tenantId, base) => parseChangeEntitlement(body, tenantId!, base),
});
