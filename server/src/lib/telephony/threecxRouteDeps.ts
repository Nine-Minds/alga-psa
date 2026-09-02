import type { ThreecxRouteDeps } from '@alga-psa/ee-threecx/lib';
import { getTelephonyProviderAvailability } from '@alga-psa/integrations/lib/telephonyAvailability';
import { resolveInboundWebhookTenantSlug } from '@/lib/inboundWebhooks/tenantResolver';
import { checkInboundWebhookRateLimit } from '@/lib/inboundWebhooks/rateLimitConfig';
import { getJobRunner } from '@/lib/jobs/JobRunnerFactory';

const THREECX_RATE_LIMIT_KEY = 'telephony-3cx';

/**
 * Real server-side wiring for the EE 3CX route handlers: the inbound-webhook
 * tenant resolver and rate limiter, the provider-availability helper, and the
 * canonical-call job enqueue.
 */
export function buildThreecxRouteDeps(): ThreecxRouteDeps {
  return {
    resolveTenantSlug: (slug) => resolveInboundWebhookTenantSlug(slug),
    checkRateLimit: async (tenantId) => {
      const result = await checkInboundWebhookRateLimit(tenantId, THREECX_RATE_LIMIT_KEY);
      return result.allowed;
    },
    getProviderAvailability: async (tenantId) => {
      const availability = await getTelephonyProviderAvailability('3cx', { tenantId });
      return availability.enabled
        ? { enabled: true }
        : { enabled: false, message: availability.message };
    },
    enqueueCanonicalCall: async ({ tenantId, record }) => {
      const runner = await getJobRunner();
      await runner.scheduleJob('process-telephony-canonical-call', { tenantId, record });
    },
  };
}
