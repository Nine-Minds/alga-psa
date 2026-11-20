/**
 * API keys of a principal kind that holds no general API credential (a co-managed seat technician) and is
 * admitted only for named purposes, such as the mobile session. The kind is written into the plaintext, so the
 * edge middleware, which cannot read the database, can hold every request carrying the key to the kind's API
 * surface before any route handler runs. The key validators refuse such an owner's key unless it carries the
 * prefix, so the prefix cannot be dropped to escape the surface.
 */

const PRINCIPAL_API_KEY_PATTERN = /^pk\.([a-z0-9_]+)\.[0-9a-f]+$/;

export function principalApiKeyPrefix(kind: string): string {
  return `pk.${kind}.`;
}

/** The principal kind a key was issued under, or null for an ordinary key. */
export function principalKindOfApiKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const match = PRINCIPAL_API_KEY_PATTERN.exec(key.trim());
  return match ? match[1] : null;
}
