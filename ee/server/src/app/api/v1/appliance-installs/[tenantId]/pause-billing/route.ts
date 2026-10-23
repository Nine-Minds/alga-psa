/**
 * Appliance Console API — pause Stripe payment collection (license keeps rolling).
 *
 * POST /api/v1/appliance-installs/:tenantId/pause-billing
 *
 * Master tenant only. Writes a pending audit row, starts the
 * `pause-billing` workflow, returns { workflow_id, audit_log_id } (202).
 */

import { createTenantActionRoute } from '@ee/lib/applianceConsole/triggerRoute';
import { parseBillingPause } from '@ee/lib/applianceConsole/actionInputs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createTenantActionRoute({
  action: 'pause-billing',
  eventType: 'appliance.billing_pause',
  parse: (body, tenantId, base) => parseBillingPause(body, tenantId!, base),
});
