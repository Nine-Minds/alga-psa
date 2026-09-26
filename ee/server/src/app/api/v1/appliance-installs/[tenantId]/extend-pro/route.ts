/**
 * Appliance Console API — grant a time-boxed comp Pro key (no Stripe involvement).
 *
 * POST /api/v1/appliance-installs/:tenantId/extend-pro
 *
 * Master tenant only. Writes a pending audit row, starts the
 * `extend-pro` workflow, returns { workflow_id, audit_log_id } (202).
 */

import { createTenantActionRoute } from '@ee/lib/applianceConsole/triggerRoute';
import { parseExtendPro } from '@ee/lib/applianceConsole/actionInputs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createTenantActionRoute({
  action: 'extend-pro',
  eventType: 'appliance.extend_pro',
  parse: (body, tenantId, base) => parseExtendPro(body, tenantId!, base),
});
