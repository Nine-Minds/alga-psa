/**
 * Appliance Console API — set registry status: active | suspended | cancelled.
 *
 * POST /api/v1/appliance-installs/:tenantId/status
 *
 * Master tenant only. Writes a pending audit row, starts the
 * `status` workflow, returns { workflow_id, audit_log_id } (202).
 */

import { createTenantActionRoute } from '@ee/lib/applianceConsole/triggerRoute';
import { parseSetStatus } from '@ee/lib/applianceConsole/actionInputs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createTenantActionRoute({
  action: 'status',
  eventType: 'appliance.status',
  parse: (body, tenantId, base) => parseSetStatus(body, tenantId!, base),
});
