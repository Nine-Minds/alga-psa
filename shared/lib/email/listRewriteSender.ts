import {
  parseEmailAddress,
  parseEmailAddressList,
  extractEmailDomain,
  type ParsedEmailAddress,
} from './addressUtils';

/**
 * Recovering the real author of mailing-list / Google-Group rewritten inbound mail.
 *
 * When a sender's domain publishes a strict DMARC policy (p=quarantine/reject),
 * mailing-list software (Google Groups, Mailman, …) rewrites the visible `From:`
 * header to the list address to avoid a DMARC failure, e.g.:
 *
 *   From: 'Jane Doe' via support <support@lists.example.com>
 *
 * The true author (jane.doe@vendor.example) survives in `X-Original-From` /
 * `X-Original-Sender` / `Reply-To`. This module detects that rewrite and recovers
 * the original sender so downstream contact-matching, watch-list seeding, and
 * notifications use the human author rather than the list address.
 *
 * When the author's domain does NOT enforce DMARC the list leaves `From:` intact
 * but still breaks SPF/DKIM alignment for it (the relay re-signs and uses its
 * own bounce address). Google Groups records the author it saw in
 * `X-Original-Sender`; when that equals `From:` and the receiving MX vouches for
 * the author domain (typically via its `arc=pass (... dkdomain=author)` verdict),
 * the message is resolved as a verified relay with `via: 'preserved-from'` so the
 * sender-auth gate does not discard the author's contact match.
 *
 * Safety: the recovered sender is only trusted when the receiving MX's
 * `Authentication-Results` (or `ARC-Authentication-Results`) show DKIM/DMARC/SPF
 * passing in alignment with the recovered domain. This prevents a spammer who
 * runs their own list software from injecting an arbitrary `X-Original-Sender`.
 * For direct (non-list) mail no list markers are present and we return null, so
 * behaviour is unchanged.
 */

export type HeaderBag = Record<string, string>;

export interface ListRewriteResolution {
  sender: ParsedEmailAddress;
  listAddress: string;
  via: 'x-original-from' | 'x-original-sender' | 'reply-to' | 'preserved-from';
}

const ENV_FLAG = 'INBOUND_RESOLVE_LIST_ORIGINAL_SENDER';

function isFeatureEnabled(): boolean {
  return (process.env[ENV_FLAG] || 'true').toLowerCase() !== 'false';
}

/**
 * Two domains are considered aligned when they are equal or one is a subdomain
 * of the other (relaxed DMARC-style alignment).
 */
function domainsAligned(a: string | null, b: string | null): boolean {
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * Scan Authentication-Results / ARC-Authentication-Results for a passing
 * mechanism whose domain aligns with `candidateDomain`. The header is added by
 * the receiving MX, so the values reflect the *original* message's auth as
 * evaluated at delivery — exactly what we need to trust the recovered sender.
 */
function authResultsTrustDomain(headers: HeaderBag, candidateDomain: string | null): boolean {
  if (!candidateDomain) {
    return false;
  }

  const combined = [headers['authentication-results'], headers['arc-authentication-results']]
    .filter(Boolean)
    .join('; ')
    .toLowerCase();

  if (!combined) {
    return false;
  }

  const domainMatchers: RegExp[] = [
    // dkim=pass ... header.i=@domain | header.d=domain | dkdomain=domain
    /dkim=pass[^;]*?(?:header\.i=@?|header\.d=|dkdomain=)([a-z0-9.-]+)/g,
    // dmarc=pass ... header.from=domain | fromdomain=domain
    /dmarc=pass[^;]*?(?:header\.from=|fromdomain=)([a-z0-9.-]+)/g,
    // spf=pass ... smtp.mailfrom=local@domain | spfdomain=domain
    /spf=pass[^;]*?(?:smtp\.mailfrom=[^@;\s]*@|spfdomain=)([a-z0-9.-]+)/g,
  ];

  for (const matcher of domainMatchers) {
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(combined)) !== null) {
      const authDomain = (match[1] || '').replace(/[.>,;\s]+$/, '');
      if (domainsAligned(candidateDomain, authDomain)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Resolve the list address the `From:` header may have been rewritten to, using
 * the list markers a relay adds. Returns null when the message carries no
 * list/group markers (i.e. ordinary direct mail).
 */
function resolveListAddress(headers: HeaderBag, fromEmail: string | null): string | null {
  const beenThere = parseEmailAddress(headers['x-beenthere'])?.email ?? null;
  const listPost = parseEmailAddress(headers['list-post'])?.email ?? null;
  const sender = parseEmailAddress(headers['sender'])?.email ?? null;
  const hasListMarkers = Boolean(
    headers['x-beenthere'] ||
    headers['list-id'] ||
    headers['list-post'] ||
    headers['mailing-list']
  );

  // A differing Sender header is itself a relay signal even without List-* headers.
  const senderIsRelay = Boolean(sender && fromEmail && sender !== fromEmail);

  if (!hasListMarkers && !senderIsRelay) {
    return null;
  }

  return beenThere || listPost || sender;
}

/**
 * Pure resolution logic (no env / no I/O) so it is straightforward to unit test.
 * `headers` keys must be lowercased.
 */
export function computeListRewriteSender(
  headers: HeaderBag,
  from: ParsedEmailAddress | null
): ListRewriteResolution | null {
  const fromEmail = from?.email ?? null;
  const listAddress = resolveListAddress(headers, fromEmail);

  if (!listAddress || !fromEmail) {
    return null;
  }

  // Preserved-From relay: the list kept the author in From but the relay hop
  // broke SPF/DKIM alignment for it. Only a relay that records the author it
  // received (X-Original-Sender / X-Original-From == From) qualifies, and the
  // receiving MX must still vouch for the author domain.
  if (fromEmail !== listAddress) {
    const recorded = [headers['x-original-from'], headers['x-original-sender']]
      .map((value) => (value ? parseEmailAddress(value)?.email ?? null : null))
      .find((email) => email && email === fromEmail);
    if (!recorded || !from) {
      return null;
    }
    if (!authResultsTrustDomain(headers, extractEmailDomain(fromEmail))) {
      return null;
    }
    return { sender: from, listAddress, via: 'preserved-from' };
  }

  const candidates: Array<{ via: ListRewriteResolution['via']; value?: string }> = [
    { via: 'x-original-from', value: headers['x-original-from'] },
    { via: 'x-original-sender', value: headers['x-original-sender'] },
    { via: 'reply-to', value: headers['reply-to'] },
  ];

  for (const candidate of candidates) {
    if (!candidate.value) {
      continue;
    }

    const parsed = candidate.via === 'reply-to'
      ? parseEmailAddressList(candidate.value)[0] ?? null
      : parseEmailAddress(candidate.value);

    if (!parsed) {
      continue;
    }

    // Ignore values that just point back at the list itself.
    if (parsed.email === listAddress) {
      continue;
    }

    // Trust anchor: the recovered sender's domain must pass DKIM/DMARC/SPF per
    // the receiving MX's Authentication-Results. This rejects forged
    // X-Original-Sender values from third-party / spam list servers.
    if (!authResultsTrustDomain(headers, extractEmailDomain(parsed.email))) {
      return null;
    }

    return { sender: parsed, listAddress, via: candidate.via };
  }

  return null;
}

/**
 * Build a lowercased header bag from a mailparser `ParsedMail`. Prefers
 * `headerLines` (raw, order-preserving) so the *topmost* Authentication-Results
 * (added by our own MX) wins; falls back to the parsed `headers` Map.
 */
function extractHeaderBag(parsed: any): HeaderBag {
  const bag: HeaderBag = {};

  const lines: Array<{ key?: string; line?: string }> | undefined = parsed?.headerLines;
  if (Array.isArray(lines)) {
    for (const entry of lines) {
      const key = typeof entry?.key === 'string' ? entry.key.toLowerCase() : '';
      const line = typeof entry?.line === 'string' ? entry.line : '';
      if (!key || key in bag) {
        // Keep the first occurrence (topmost header) — matters for
        // Authentication-Results, which is prepended by the final MTA.
        continue;
      }
      const colon = line.indexOf(':');
      bag[key] = colon >= 0 ? line.slice(colon + 1).trim() : '';
    }
    return bag;
  }

  const map: Map<string, unknown> | undefined = parsed?.headers;
  if (map && typeof map.forEach === 'function') {
    map.forEach((value: unknown, key: string) => {
      const lower = key.toLowerCase();
      if (typeof value === 'string') {
        bag[lower] = value;
      } else if (value && typeof value === 'object' && 'text' in (value as any)) {
        bag[lower] = String((value as any).text ?? '');
      } else if (value != null) {
        bag[lower] = String(value);
      }
    });
  }

  return bag;
}

/**
 * Resolve the original sender from a mailparser `ParsedMail`, honouring the
 * feature flag. Returns null when disabled, when the message is not a list
 * rewrite, or when the recovered sender cannot be trusted.
 */
export function resolveListRewriteSender(parsed: any): ListRewriteResolution | null {
  if (!isFeatureEnabled()) {
    return null;
  }

  const fromValue = parsed?.from?.value?.[0];
  const from: ParsedEmailAddress | null = fromValue?.address
    ? { email: String(fromValue.address).toLowerCase(), name: fromValue.name || undefined }
    : parseEmailAddress(parsed?.from?.text);

  return computeListRewriteSender(extractHeaderBag(parsed), from);
}
