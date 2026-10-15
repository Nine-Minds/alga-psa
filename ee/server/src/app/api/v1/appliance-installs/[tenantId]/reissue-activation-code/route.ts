/**
 * Appliance Console API — mint a fresh in-app activation code (rebinds: prior appliance credentials are revoked).
 *
 * POST /api/v1/appliance-installs/:tenantId/reissue-activation-code
 *
 * Master tenant only. Writes a pending audit row, starts the
 * `reissue-activation-code` workflow, returns { workflow_id, audit_log_id } (202).
 */

import { createTenantActionRoute } from '@ee/lib/applianceConsole/triggerRoute';
import { parseReissueActivationCode } from '@ee/lib/applianceConsole/actionInputs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createTenantActionRoute({
  action: 'reissue-activation-code',
  eventType: 'appliance.reissue_activation_code',
  parse: (body, tenantId, base) => parseReissueActivationCode(body, tenantId!, base),
});
