/**
 * RMM Device Sync Schedule API
 * PUT /api/v1/integrations/rmm/{provider}/device-sync — turn the recurring
 * device sync on or off and set its cadence.
 *
 * Writes desired state only. The reconciler converges the actual schedule on
 * its next pass (a few minutes), so it stays the single place that decides what
 * schedules exist — the same contract the settings UI writes against.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { hasPermission } from '@/lib/auth/rbac';
import { createTenantKnex } from '@/lib/db';
import { withApiKeyAuth } from '@/lib/api/middleware/apiAuthMiddleware';
import {
  createSuccessResponse,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/lib/api/middleware/apiMiddleware';
import {
  DEVICE_SYNC_MAX_MINUTES,
  DEVICE_SYNC_MIN_MINUTES,
  readRmmIntegrationStatuses,
  writeDeviceSyncSettings,
} from '@alga-psa/integrations/lib/rmm/rmmIntegrationStatus';

const bodySchema = z.object({
  enabled: z.boolean(),
  // Rejected rather than clamped: silently honouring a different cadence than
  // the caller asked for is worse than telling them the value is out of range.
  intervalMinutes: z
    .number()
    .int()
    .min(DEVICE_SYNC_MIN_MINUTES)
    .max(DEVICE_SYNC_MAX_MINUTES)
    .optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  const handler = await withApiKeyAuth(async (req) => {
    if (!req.context?.user) throw new ForbiddenError('User context required');

    const { knex, tenant } = await createTenantKnex(req.context.tenant);
    if (!(await hasPermission(req.context.user, 'system_settings', 'update', knex))) {
      throw new ForbiddenError('Permission denied: Cannot update RMM integrations');
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Invalid request body', parsed.error.issues);
    }

    const result = await writeDeviceSyncSettings(knex, tenant!, {
      provider: provider as never,
      enabled: parsed.data.enabled,
      intervalMinutes: parsed.data.intervalMinutes,
    });
    if (!result.found) {
      throw new NotFoundError(`No ${provider} integration is configured for this tenant`);
    }

    const statuses = await readRmmIntegrationStatuses(knex, tenant!);
    return createSuccessResponse(statuses[provider]);
  });

  return handler(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
