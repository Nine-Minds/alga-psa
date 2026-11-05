import {
  parseEmailAddress,
  parseEmailAddressList,
  type ParsedEmailAddress,
} from './addressUtils';

/**
 * Identify a candidate author for mailing-list / Google-Group rewritten inbound mail.
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
 * When the author's domain does NOT enforce DMARC the list may leave `From:`
 * intact while the relay re-signs using its own bounce address. List markers and
 * relay headers can suggest a candidate for confirmation, but are message data.
 *
 * Safety: no `Authentication-Results`, `ARC-Authentication-Results`, or other
 * list header can authorize this identity. Callers must independently verify
 * the original message or require registered-mailbox confirmation. For direct
 * mail with no list markers this returns null.
 */

export type HeaderBag = Record<string, string>;

export interface ListRewriteCandidate {
  sender: ParsedEmailAddress;
  listAddress: string;
  via: 'x-original-from' | 'x-original-sender' | 'reply-to' | 'preserved-from';
}

const ENV_FLAG = 'INBOUND_RESOLVE_LIST_ORIGINAL_SENDER';

function isFeatureEnabled(): boolean {
  return (process.env[ENV_FLAG] || 'true').toLowerCase() !== 'false';
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
export function computeListRewriteCandidate(
  headers: HeaderBag,
  from: ParsedEmailAddress | null
): ListRewriteCandidate | null {
  const fromEmail = from?.email ?? null;
  const listAddress = resolveListAddress(headers, fromEmail);

  if (!listAddress || !fromEmail) {
    return null;
  }

  // Preserved-From relay: the list kept the candidate in From but the relay hop
  // broke SPF/DKIM alignment for it. The matching list record identifies a
  // candidate only; it is never proof that the candidate authored the message.
  if (fromEmail !== listAddress) {
    const recorded = [headers['x-original-from'], headers['x-original-sender']]
      .map((value) => (value ? parseEmailAddress(value)?.email ?? null : null))
      .find((email) => email && email === fromEmail);
    if (!recorded || !from) {
      return null;
    }
    return { sender: from, listAddress, via: 'preserved-from' };
  }

  const candidates: Array<{ via: ListRewriteCandidate['via']; value?: string }> = [
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

    // A syntactically plausible list field is only a candidate. The caller
    // independently verifies original MIME DKIM and requires confirmation
    // whenever that evidence does not establish contact-domain control.
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
 * Resolve a candidate sender from a mailparser `ParsedMail`, honouring the
 * feature flag. Authentication and ARC headers are ignored. Returns null when
 * disabled or when the message has no structurally recognizable list rewrite.
 */
export function resolveListRewriteCandidate(parsed: any): ListRewriteCandidate | null {
  if (!isFeatureEnabled()) {
    return null;
  }

  const fromValue = parsed?.from?.value?.[0];
  const from: ParsedEmailAddress | null = fromValue?.address
    ? { email: String(fromValue.address).toLowerCase(), name: fromValue.name || undefined }
    : parseEmailAddress(parsed?.from?.text);

  return computeListRewriteCandidate(extractHeaderBag(parsed), from);
}
