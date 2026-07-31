import dns from 'node:dns/promises';
import net from 'node:net';
import { getConnection } from '@/lib/db/db';

/**
 * CIMD (Client ID Metadata Documents) client resolution. The OAuth `client_id`
 * IS an https URL that hosts a JSON metadata document; we fetch + validate it and
 * cache the result in `mcp_oauth_clients`. No DCR write endpoint exists, so this
 * is the only way clients enter the system. The fetch is SSRF-hardened.
 */

const FETCH_TIMEOUT_MS = 4000;
const MAX_DOC_BYTES = 64 * 1024;
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface OAuthClient {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
}

interface ClientRow {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[] | string;
  metadata: unknown;
  last_seen_at: string | null;
}

export class ClientResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientResolutionError';
  }
}

/** Reject non-https and any URL whose host resolves to a private/loopback address. */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ClientResolutionError('client_id must be a valid URL.');
  }
  if (url.protocol !== 'https:') {
    throw new ClientResolutionError('client_id must be an https URL.');
  }
  if (url.username || url.password) {
    throw new ClientResolutionError('client_id must not contain credentials.');
  }
  const host = url.hostname;
  // Reject obvious internal names early.
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new ClientResolutionError('client_id host is not allowed.');
  }
  // Resolve and ensure every address is public (defeats DNS-rebinding to private IPs).
  const addrs: string[] = [];
  if (net.isIP(host)) {
    addrs.push(host);
  } else {
    const records = await dns.lookup(host, { all: true }).catch(() => []);
    if (records.length === 0) throw new ClientResolutionError('client_id host did not resolve.');
    addrs.push(...records.map((r) => r.address));
  }
  for (const addr of addrs) {
    if (isPrivateAddress(addr)) {
      throw new ClientResolutionError('client_id host resolves to a non-public address.');
    }
  }
  return url;
}

export function isPrivateAddress(addr: string): boolean {
  const v = net.isIP(addr);
  if (v === 4) {
    const p = addr.split('.').map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local (incl. cloud metadata)
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 0) return true;
    return false;
  }
  if (v === 6) {
    const a = addr.toLowerCase();
    if (a === '::1' || a === '::') return true;
    if (a.startsWith('fe80')) return true; // link-local
    if (a.startsWith('fc') || a.startsWith('fd')) return true; // unique-local
    if (a.startsWith('::ffff:')) return isPrivateAddress(a.slice(7)); // v4-mapped
    return false;
  }
  return true; // unknown format → treat as unsafe
}

async function fetchClientMetadata(url: URL): Promise<{ clientName: string | null; redirectUris: string[]; raw: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'error', // do not follow redirects (SSRF / scope creep)
      headers: { accept: 'application/json' },
    });
  } catch {
    throw new ClientResolutionError('Failed to fetch client metadata document.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ClientResolutionError(`Client metadata fetch returned ${res.status}.`);
  const len = Number(res.headers.get('content-length') ?? '0');
  if (len && len > MAX_DOC_BYTES) throw new ClientResolutionError('Client metadata document too large.');
  const text = await res.text();
  if (text.length > MAX_DOC_BYTES) throw new ClientResolutionError('Client metadata document too large.');
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ClientResolutionError('Client metadata document is not valid JSON.');
  }
  const redirectUris = Array.isArray(doc.redirect_uris)
    ? (doc.redirect_uris.filter((u) => typeof u === 'string') as string[])
    : [];
  if (redirectUris.length === 0) {
    throw new ClientResolutionError('Client metadata document has no redirect_uris.');
  }
  // Per CIMD, the client_id (document URL) must equal the document's client_id.
  if (typeof doc.client_id === 'string' && doc.client_id !== url.toString()) {
    throw new ClientResolutionError('Client metadata client_id does not match the document URL.');
  }
  const clientName = typeof doc.client_name === 'string' ? doc.client_name : null;
  return { clientName, redirectUris, raw: doc };
}

function rowToClient(row: ClientRow): OAuthClient {
  const uris = typeof row.redirect_uris === 'string' ? (JSON.parse(row.redirect_uris) as string[]) : row.redirect_uris;
  return { clientId: row.client_id, clientName: row.client_name, redirectUris: uris ?? [] };
}

/**
 * Resolve a CIMD client_id to its (cached) record, fetching + validating the
 * metadata document on a cache miss / staleness.
 */
export async function resolveClient(clientId: string): Promise<OAuthClient> {
  const knex = await getConnection(null);
  const cached = (await knex('mcp_oauth_clients').where({ client_id: clientId }).first()) as
    | ClientRow
    | undefined;
  const fresh =
    cached?.last_seen_at != null && Date.now() - new Date(cached.last_seen_at).getTime() < CACHE_TTL_MS;
  if (cached && fresh) return rowToClient(cached);

  const url = await assertPublicHttpsUrl(clientId);
  const { clientName, redirectUris, raw } = await fetchClientMetadata(url);

  await knex('mcp_oauth_clients')
    .insert({
      client_id: clientId,
      client_name: clientName,
      redirect_uris: JSON.stringify(redirectUris),
      source: 'cimd',
      metadata: JSON.stringify(raw),
      last_seen_at: knex.fn.now(),
    })
    .onConflict('client_id')
    .merge({
      client_name: clientName,
      redirect_uris: JSON.stringify(redirectUris),
      metadata: JSON.stringify(raw),
      last_seen_at: knex.fn.now(),
    });

  return { clientId, clientName, redirectUris };
}

/** Exact-match redirect_uri validation against the client's declared set. */
export function validateRedirectUri(client: OAuthClient, redirectUri: string): boolean {
  return client.redirectUris.includes(redirectUri);
}

/** List the clients a user has authorized (for the Settings "connected clients" view). */
export async function listConnectedClients(
  tenant: string,
  userId: string,
): Promise<Array<{ grantId: string; clientId: string; clientName: string | null; consentedAt: string }>> {
  const knex = await getConnection(null);
  const rows = await knex('mcp_oauth_grants as g')
    .leftJoin('mcp_oauth_clients as c', 'c.client_id', 'g.client_id')
    .where({ 'g.tenant': tenant, 'g.user_id': userId })
    .whereNull('g.revoked_at')
    .select('g.grant_id as grantId', 'g.client_id as clientId', 'c.client_name as clientName', 'g.consented_at as consentedAt');
  return rows as Array<{ grantId: string; clientId: string; clientName: string | null; consentedAt: string }>;
}
