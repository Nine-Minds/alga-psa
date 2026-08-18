/**
 * RMM Device Sync Trigger API
 * POST /api/v1/integrations/rmm/{provider}/sync — run a device sync now.
 *
 * Runs through the same strategy the scheduled job uses, so an on-demand sync
 * and a scheduled one cannot ingest differently. Synchronous: it returns when
 * the sync finishes, which for a large estate can take minutes.
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
  RmmIntegrationInactiveError,
  RmmIntegrationNotFoundError,
  RmmProviderNotSchedulableError,
  triggerRmmDeviceSync,
} from '@/lib/api/services/rmmDeviceSyncTriggerService';

const bodySchema = z.object({
  syncType: z.enum(['full', 'incremental']).default('incremental'),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  const handler = await withApiKeyAuth(async (req) => {
    if (!req.context?.user) throw new ForbiddenError('User context required');

    const { knex, tenant } = await createTenantKnex(req.context.tenant);
    // 'update' rather than 'read': this spends provider API quota and writes assets.
    if (!(await hasPermission(req.context.user, 'system_settings', 'update', knex))) {
      throw new ForbiddenError('Permission denied: Cannot trigger an RMM sync');
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      throw new ValidationError('Invalid request body', parsed.error.issues);
    }

    try {
      const result = await triggerRmmDeviceSync(
        knex,
        tenant!,
        provider as never,
        parsed.data.syncType
      );
      return createSuccessResponse(result);
    } catch (error) {
      if (error instanceof RmmIntegrationNotFoundError) {
        throw new NotFoundError(error.message);
      }
      if (error instanceof RmmProviderNotSchedulableError || error instanceof RmmIntegrationInactiveError) {
        throw new ValidationError(error.message);
      }
      // Provider failures reach here as thrown errors by design: the strategies
      // translate a reported failure into a throw so a failed window is never
      // mistaken for a successful one.
      throw error;
    }
  });

  return handler(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
