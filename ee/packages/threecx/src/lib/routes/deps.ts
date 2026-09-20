import type { CanonicalCallRecord, CanonicalChatRecord } from '@alga-psa/telephony/types';

/**
 * Server-only primitives injected into the EE route handlers. The route files
 * under server/ wire the real implementations (inbound-webhook tenant resolver,
 * rate limiter, provider-availability helper, job enqueue); the handlers stay
 * unit-testable against fakes.
 */
export interface ThreecxRouteDeps {
  resolveTenantSlug(slug: string): Promise<string | null>;
  checkRateLimit(tenantId: string): Promise<boolean>;
  getProviderAvailability(tenantId: string): Promise<{ enabled: boolean; message?: string }>;
  enqueueCanonicalCall(input: { tenantId: string; record: CanonicalCallRecord }): Promise<void>;
  enqueueChat(input: { tenantId: string; chat: CanonicalChatRecord }): Promise<void>;
}
