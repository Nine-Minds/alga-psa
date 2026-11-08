/**
 * Quote access links: per-recipient, unauthenticated links to a quote.
 *
 * Security model
 *  - The token is 256 bits from crypto.randomBytes, base64url encoded.
 *  - Only sha256(token) (lowercase hex) is stored. There is no raw-token column.
 *  - The raw token is returned exactly once, by `mint`. No other function
 *    returns it, and nothing here logs it.
 *  - `resolve` performs exactly one tenantless query (hash -> tenant, selecting
 *    `tenant` only). Everything after it is tenant-scoped through tenantDb.
 *
 * Design decision (read-only after decision): accepted / rejected / converted
 * quotes stay viewable through the link, read-only, until `expires_at`. That
 * lets the signer reopen the quote, and the signed copy (card 6) is served
 * through the same link. Decisions therefore do NOT revoke links. The `decided`
 * status is reserved for decided quotes that must not be viewable at all; it is
 * part of the result type but is not currently produced.
 *
 * Attempt limiting is in-memory (RateLimiterMemory), so it is per-process: with
 * N server replicas the effective ceiling is N times the configured limit. The
 * 256-bit token space makes guessing infeasible regardless; the limiter exists
 * to bound abuse/DoS on the lookup.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Knex } from 'knex';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { getConnection, tenantDb } from '@alga-psa/db';
import type { IQuote } from '@alga-psa/types';

const TABLE = 'quote_access_links';
const TOKEN_BYTES = 32;
/** base64url of 32 bytes, no padding. */
export const QUOTE_ACCESS_TOKEN_LENGTH = 43;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_VALIDITY_MS = 30 * DAY_MS;
const MAX_VALIDITY_MS = 90 * DAY_MS;
const MIN_VALIDITY_MS = DAY_MS;

const TOKEN_DISCOVERY_TENANT = 'quote-access-token-discovery';
const TOKEN_DISCOVERY_REASON = 'public quote access token lookup before tenant is known';

export type QuoteAccessLinkRevokeReason = 'superseded' | 'cancelled' | 'manual';

export interface IQuoteAccessLink {
  tenant: string;
  link_id: string;
  quote_id: string;
  contact_id: string | null;
  recipient_email: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
  last_used_at: Date | null;
  use_count: number;
  created_by: string | null;
  created_at: Date;
}

export type QuoteAccessResolveFailure =
  | 'not_found'
  | 'expired'
  | 'revoked'
  | 'superseded'
  /** Reserved: decided quotes that must not be viewable at all. Not produced today. */
  | 'decided'
  | 'rate_limited';

export type QuoteAccessResolveResult =
  | {
      status: 'ok';
      tenant: string;
      quote: IQuote;
      link: IQuoteAccessLink;
      recipient: { contactId: string | null; email: string };
      readOnly: boolean;
    }
  | { status: QuoteAccessResolveFailure };

export interface MintQuoteAccessLinkInput {
  quote: Pick<IQuote, 'quote_id' | 'valid_until'>;
  recipient: { contactId?: string | null; email: string };
  createdBy?: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function generateQuoteAccessToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashQuoteAccessToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isWellFormedQuoteAccessToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/**
 * expires_at = min(valid_until ?? now+30d, now+90d), floored at now+24h.
 * valid_until is treated as the end of that UTC day (the quote is valid through
 * the whole day, matching isExpiredOnAccess), i.e. the start of the next UTC day.
 */
export function computeQuoteAccessExpiry(
  validUntil: string | Date | null | undefined,
  now: Date = new Date()
): Date {
  const nowMs = now.getTime();
  let candidate = nowMs + DEFAULT_VALIDITY_MS;

  if (validUntil) {
    const parsed = new Date(validUntil);
    if (!Number.isNaN(parsed.getTime())) {
      candidate = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate() + 1);
    }
  }

  const capped = Math.min(candidate, nowMs + MAX_VALIDITY_MS);
  return new Date(Math.max(capped, nowMs + MIN_VALIDITY_MS));
}

// ---------------------------------------------------------------------------
// Attempt limiting (per-process; see file header)
// ---------------------------------------------------------------------------

function createLimiters() {
  return {
    ip: new RateLimiterMemory({ keyPrefix: 'quote_access_ip', points: 30, duration: 5 * 60 }),
    token: new RateLimiterMemory({ keyPrefix: 'quote_access_token', points: 60, duration: 60 * 60 }),
  };
}

let limiters = createLimiters();

/** Test hook: reset in-memory limiter state. */
export function resetQuoteAccessRateLimiters(): void {
  limiters = createLimiters();
}

/** Returns true if the attempt is allowed. Keys are hashes, never raw tokens. */
async function consumeAttempt(tokenHash: string, ip?: string | null): Promise<boolean> {
  try {
    if (ip) {
      await limiters.ip.consume(ip);
    }
    await limiters.token.consume(tokenHash);
    return true;
  } catch {
    // RateLimiterMemory rejects with RateLimiterRes when the limit is exceeded.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

function links(conn: Knex | Knex.Transaction, tenant: string) {
  return tenantDb(conn, tenant).table<IQuoteAccessLink>(TABLE);
}

export async function mint(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  input: MintQuoteAccessLinkInput
): Promise<{ link: IQuoteAccessLink; token: string }> {
  if (!tenant) {
    throw new Error('Tenant context is required for minting a quote access link');
  }
  const token = generateQuoteAccessToken();
  const expiresAt = computeQuoteAccessExpiry(input.quote.valid_until);

  const [link] = await links(knexOrTrx, tenant)
    .insert({
      tenant,
      quote_id: input.quote.quote_id,
      contact_id: input.recipient.contactId ?? null,
      recipient_email: input.recipient.email,
      token_hash: hashQuoteAccessToken(token),
      expires_at: expiresAt,
      created_by: input.createdBy ?? null,
    } as any)
    .returning('*');

  return { link, token };
}

export async function resolve(
  token: string,
  ctx: { ip?: string | null } = {},
  knexOverride?: Knex | Knex.Transaction
): Promise<QuoteAccessResolveResult> {
  const hash = hashQuoteAccessToken(typeof token === 'string' ? token : '');

  // 1. Rate limit (keyed on the hash, never the raw token).
  if (!(await consumeAttempt(hash, ctx.ip))) {
    return { status: 'rate_limited' };
  }

  // 2. Malformed tokens never reach the database.
  if (!isWellFormedQuoteAccessToken(token)) {
    return { status: 'not_found' };
  }

  const knex = knexOverride ?? (await getConnection());

  // 3. The single tenantless query: hash -> tenant, selecting tenant only.
  const discovery = await tenantDb(knex, TOKEN_DISCOVERY_TENANT)
    .unscoped(TABLE, TOKEN_DISCOVERY_REASON)
    .select('tenant')
    .where('token_hash', hash)
    .first<{ tenant: string }>();
  if (!discovery?.tenant) {
    return { status: 'not_found' };
  }
  const tenant = discovery.tenant;

  // 4. Tenant-scoped reads. expiry is evaluated on the DB clock.
  const db = tenantDb(knex, tenant);
  const link = await db
    .table<IQuoteAccessLink & { is_expired: boolean }>(TABLE)
    .select('*', knex.raw('(expires_at <= now()) as is_expired'))
    .where({ token_hash: hash })
    .first();
  if (!link) {
    return { status: 'not_found' };
  }
  const quote = await db.table<IQuote>('quotes').where({ quote_id: link.quote_id }).first();
  if (!quote) {
    return { status: 'not_found' };
  }

  // 5. Status mapping.
  if (link.is_expired) {
    return { status: 'expired' };
  }
  if (link.revoked_at && link.revoked_reason === 'superseded') {
    return { status: 'superseded' };
  }
  if (quote.status === 'superseded') {
    return { status: 'superseded' };
  }
  if (link.revoked_at) {
    return { status: 'revoked' };
  }

  const readOnly = quote.status === 'accepted' || quote.status === 'rejected' || quote.status === 'converted';

  // 7. Usage bump (only these two columns).
  await db
    .table(TABLE)
    .where({ link_id: link.link_id })
    .update({ last_used_at: knex.fn.now(), use_count: knex.raw('use_count + 1') });

  const { is_expired: _isExpired, ...cleanLink } = link;
  return {
    status: 'ok',
    tenant,
    quote,
    link: cleanLink as IQuoteAccessLink,
    recipient: { contactId: link.contact_id ?? null, email: link.recipient_email },
    readOnly,
  };
}

export async function revoke(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  target: { quoteId: string } | { linkId: string },
  reason: QuoteAccessLinkRevokeReason
): Promise<number> {
  if (!tenant) {
    throw new Error('Tenant context is required for revoking quote access links');
  }
  const where = 'quoteId' in target ? { quote_id: target.quoteId } : { link_id: target.linkId };
  const count = await links(knexOrTrx, tenant)
    .where(where)
    .whereNull('revoked_at')
    .update({ revoked_at: knexOrTrx.fn.now(), revoked_reason: reason } as any);
  return Number(count);
}

export const QuoteAccessLinks = { mint, resolve, revoke };
