/**
 * Appliance Console API — resume Stripe payment collection.
 *
 * POST /api/v1/appliance-installs/:tenantId/resume-billing
 *
 * Master tenant only. Writes a pending audit row, starts the
 * `resume-billing` workflow, returns { workflow_id, audit_log_id } (202).
 */

import { createTenantActionRoute } from '@ee/lib/applianceConsole/triggerRoute';
import { parseBillingResume } from '@ee/lib/applianceConsole/actionInputs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createTenantActionRoute({
  action: 'resume-billing',
  eventType: 'appliance.billing_resume',
  parse: (body, tenantId, base) => parseBillingResume(body, tenantId!, base),
});
