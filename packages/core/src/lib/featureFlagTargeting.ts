/**
 * Server-only, runtime, tenant-scoped targeting for ANY feature flag.
 *
 * One source, keyed by flag: the environment variable
 *
 *   FEATURE_FLAG_TENANTS__<KEY>=<tenant-uuid>[,<tenant-uuid>...]
 *
 * where <KEY> is the flag key upper-cased with every non-alphanumeric run
 * replaced by `_` (`release-v2-0-feature` -> `RELEASE_V2_0_FEATURE`). It is read
 * at evaluation time (no rebuild, never `NEXT_PUBLIC_*`), so it cannot reach a
 * browser bundle.
 *
 * Semantics, per flag, and nothing else is affected:
 *  - variable unset            -> `null`: not targeted, the normal evaluator decides;
 *  - variable set and valid    -> authoritative: on for listed tenants, off for all others;
 *  - set but empty/malformed   -> authoritative OFF for everyone (the whole value is
 *                                 rejected rather than partially applied);
 *  - no wildcard; a missing tenant id is off and a user id is never a tenant.
 *
 * Authoritative means it also sits above the global DISABLE_FEATURE_FLAGS
 * development override, so a flag an operator has closed cannot be opened by it.
 */

const TENANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function flagTargetingEnvName(flagKey: string): string {
  return `FEATURE_FLAG_TENANTS__${flagKey.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

/** `null` = this flag is not tenant-targeted; otherwise the authoritative answer. */
export function resolveFlagTargeting(
  flagKey: string,
  tenantId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean | null {
  if (typeof window !== 'undefined' || typeof process === 'undefined') return null;
  const raw = env[flagTargetingEnvName(flagKey)];
  if (raw === undefined) return null;

  const tenants = raw.split(',').map((id) => id.trim().toLowerCase());
  if (!tenantId || tenants.some((id) => !TENANT_UUID.test(id))) return false;
  return tenants.includes(tenantId.toLowerCase());
}
