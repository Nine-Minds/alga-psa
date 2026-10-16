/**
 * Appliance Console API — reissue a fresh install code (revokes unclaimed ones).
 *
 * POST /api/v1/appliance-installs/:tenantId/reissue-install-code
 *
 * Master tenant only. Writes a pending audit row, starts the
 * `reissue-install-code` workflow, returns { workflow_id, audit_log_id } (202).
 */

import { createTenantActionRoute } from '@ee/lib/applianceConsole/triggerRoute';
import { parseReissueInstallCode } from '@ee/lib/applianceConsole/actionInputs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createTenantActionRoute({
  action: 'reissue-install-code',
  eventType: 'appliance.reissue_install_code',
  parse: (body, tenantId, base) => parseReissueInstallCode(body, tenantId!, base),
});
