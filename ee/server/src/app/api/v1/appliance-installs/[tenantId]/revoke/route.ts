/**
 * Appliance Console API — soft-revoke the entitlement; hard additionally revokes appliance credentials.
 *
 * POST /api/v1/appliance-installs/:tenantId/revoke
 *
 * Master tenant only. Writes a pending audit row, starts the
 * `revoke` workflow, returns { workflow_id, audit_log_id } (202).
 */

import { createTenantActionRoute } from '@ee/lib/applianceConsole/triggerRoute';
import { parseRevoke } from '@ee/lib/applianceConsole/actionInputs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createTenantActionRoute({
  action: 'revoke',
  eventType: 'appliance.revoke',
  parse: (body, tenantId, base) => parseRevoke(body, tenantId!, base),
});
