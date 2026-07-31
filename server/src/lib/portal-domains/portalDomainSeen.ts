import { getRedisClient } from '@/config/redisConfig';

/**
 * Best-effort "last seen on its Host" tracking for custom portal domains.
 *
 * On the appliance the operator owns the reverse proxy, so the only signal that a
 * vanity domain is actually reachable is observing a request arrive bearing that
 * Host. We record a timestamp when that happens; Settings warns when an active
 * domain has never been seen (a likely sign the proxy isn't forwarding `Host`).
 *
 * Everything here is best-effort: Redis failures never propagate to the caller.
 */

const SEEN_KEY_PREFIX = 'portal-domain:last-seen:';
const SEEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function seenKey(hostname: string): string {
  return `${SEEN_KEY_PREFIX}${hostname.trim().toLowerCase()}`;
}

export async function recordPortalDomainSeen(hostname: string | null | undefined): Promise<void> {
  const host = hostname?.trim().toLowerCase();
  if (!host) {
    return;
  }
  let client: Awaited<ReturnType<typeof getRedisClient>> | undefined;
  try {
    client = await getRedisClient();
    await client.setEx(seenKey(host), SEEN_TTL_SECONDS, String(Date.now()));
  } catch {
    // best-effort: diagnostics must never block a request
  } finally {
    try {
      await client?.quit();
    } catch {
      /* ignore */
    }
  }
}

export async function getPortalDomainLastSeen(hostname: string | null | undefined): Promise<number | null> {
  const host = hostname?.trim().toLowerCase();
  if (!host) {
    return null;
  }
  let client: Awaited<ReturnType<typeof getRedisClient>> | undefined;
  try {
    client = await getRedisClient();
    const value = await client.get(seenKey(host));
    return value ? Number(value) : null;
  } catch {
    return null;
  } finally {
    try {
      await client?.quit();
    } catch {
      /* ignore */
    }
  }
}

export async function clearPortalDomainSeen(hostname: string | null | undefined): Promise<void> {
  const host = hostname?.trim().toLowerCase();
  if (!host) {
    return;
  }
  let client: Awaited<ReturnType<typeof getRedisClient>> | undefined;
  try {
    client = await getRedisClient();
    await client.del(seenKey(host));
  } catch {
    // best-effort
  } finally {
    try {
      await client?.quit();
    } catch {
      /* ignore */
    }
  }
}
