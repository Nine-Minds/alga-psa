/**
 * Appliance Console API — re-sign the air-gap license key bound to this tenant.
 *
 * POST /api/v1/appliance-installs/:tenantId/airgap-key
 *
 * Master tenant only. Writes a pending audit row, starts the
 * `airgap-key` workflow, returns { workflow_id, audit_log_id } (202).
 */

import { createTenantActionRoute } from '@ee/lib/applianceConsole/triggerRoute';
import { parseAirgapKey } from '@ee/lib/applianceConsole/actionInputs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createTenantActionRoute({
  action: 'airgap-key',
  eventType: 'appliance.airgap_key',
  parse: (body, tenantId, base) => parseAirgapKey(body, tenantId!, base),
});
