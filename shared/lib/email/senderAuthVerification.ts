import { extractEmailDomain } from './addressUtils';

export interface SenderAuthResults {
  spf: 'pass' | 'fail' | 'neutral' | 'none' | 'temperror' | 'permerror' | null;
  dkim: 'pass' | 'fail' | 'neutral' | 'none' | 'temperror' | 'permerror' | null;
  dmarc: 'pass' | 'fail' | 'neutral' | 'none' | 'temperror' | 'permerror' | null;
  aligned: { spf: boolean; dkim: boolean; dmarc: boolean };
}

/** Keep repeated provider header fields in their original order. */
export function orderedAuthenticationResults(headers: Array<{ name?: unknown; value?: unknown }>): string[] {
  return headers
    .filter((header) => String(header?.name ?? '').toLowerCase() === 'authentication-results')
    .map((header) => header.value)
    .filter((value): value is string => typeof value === 'string');
}

const RESULT = /\b(spf|dkim|dmarc)\s*=\s*(pass|fail|neutral|none|temperror|permerror)\b([^;]*)/gi;

/**
 * Unfolds RFC 5322 continuation lines (a CRLF followed by whitespace continues
 * the previous header line) so a folded Authentication-Results header is parsed
 * as a single authserv block.
 */
function unfoldHeader(value: string): string {
  return value.replace(/\r?\n[ \t]+/g, ' ');
}

/**
 * Strips RFC 8601 parenthesized comments from a header block. Comment text must
 * not feed mechanism/property matching (e.g. the `spf=pass dmarc=pass` tokens
 * Google nests inside `arc=pass (...)` or its free-text SPF comment).
 * Repeatedly removes innermost `(…)` spans until none remain, which handles
 * balanced nesting without a full recursive parser.
 */
function stripComments(value: string): string {
  let current = value;
  let previous: string;
  do {
    previous = current;
    current = current.replace(/\([^()]*\)/g, ' ');
  } while (current !== previous);
  return current;
}

/**
 * Reduces a domain-bearing property value to its bare domain: a value may be a
 * plain domain (`example.com`), an address (`munjal@example.com`), or Google's
 * DKIM signer `header.i` shape (`@example.com` / `user@example.com`). In every
 * case only the text after the last `@` matters for alignment.
 */
function extractDomain(value: string | undefined): string {
  if (!value) return '';
  const atIndex = value.lastIndexOf('@');
  const withoutLocalPart = atIndex >= 0 ? value.slice(atIndex + 1) : value;
  return withoutLocalPart.trim().replace(/[>;,)]+$/, '').toLowerCase();
}

function domainAligned(candidate: string | undefined, fromDomain: string | null): boolean {
  if (!candidate || !fromDomain) return false;
  const domain = extractDomain(candidate);
  return domain === fromDomain || domain.endsWith(`.${fromDomain}`);
}

/**
 * Parses the Authentication-Results header added by the receiving MTA. Missing or
 * malformed headers deliberately return null: sender attribution must fail closed.
 * A single header is one authserv block; when callers supply multiple values, the
 * first value is the topmost (our-MTA) result per RFC 8601 handling policy.
 */
export function verifySenderAuthentication(
  authenticationResults: string | string[] | null | undefined,
  fromEmail: string | null | undefined
): SenderAuthResults | null {
  // Multiple values are multiple authserv blocks; a single string may still fold
  // across physical lines, so unfold continuation lines first, then split on
  // remaining newlines and keep only the topmost block (RFC 8601 handling).
  const rawBlocks = Array.isArray(authenticationResults)
    ? authenticationResults
    : typeof authenticationResults === 'string' && authenticationResults.trim()
      ? unfoldHeader(authenticationResults).split(/\r?\n/)
      : [];
  const blocks = rawBlocks
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(unfoldHeader);
  const block = blocks[0];
  const fromDomain = extractEmailDomain(fromEmail ?? '')?.toLowerCase() ?? null;
  if (!block || !fromDomain) return null;

  // Drop parenthesized comments before mechanism matching so comment text
  // (e.g. the `spf=pass dmarc=pass` tokens inside Google's `arc=pass (...)` or
  // its free-text SPF comment) cannot fabricate results.
  const commentFree = stripComments(block);

  const results: SenderAuthResults = {
    spf: null, dkim: null, dmarc: null,
    aligned: { spf: false, dkim: false, dmarc: false },
  };
  let match: RegExpExecArray | null;
  let found = false;
  while ((match = RESULT.exec(commentFree))) {
    found = true;
    const mechanism = match[1].toLowerCase() as 'spf' | 'dkim' | 'dmarc';
    const verdict = match[2].toLowerCase() as NonNullable<SenderAuthResults[typeof mechanism]>;
    const properties = match[3] ?? '';
    results[mechanism] = verdict;
    const domain = mechanism === 'spf'
      ? properties.match(/\bsmtp\.mailfrom\s*=\s*([^\s;]+)/i)?.[1]
      : mechanism === 'dkim'
        ? properties.match(/\bheader\.d\s*=\s*([^\s;]+)/i)?.[1]
          ?? properties.match(/\bheader\.i\s*=\s*([^\s;]+)/i)?.[1]
        : properties.match(/\bheader\.from\s*=\s*([^\s;]+)/i)?.[1];
    results.aligned[mechanism] = verdict === 'pass' && domainAligned(domain, fromDomain);
  }
  return found ? results : null;
}

export function allowsInternalSenderAttribution(results: SenderAuthResults | null): boolean {
  return Boolean(results?.aligned.dmarc || (results?.aligned.spf && results?.aligned.dkim));
}

export function isInternalAttributionTrusted(
  evidence: { provider: 'google' | 'microsoft'; authenticationResults: string[]; receivingAuthservId?: string; receivingAuthservIds?: string[] } | null | undefined,
  fromEmail: string | null | undefined
): boolean {
  return allowsInternalSenderAttribution(verifyProviderSenderAuthentication(evidence, fromEmail));
}

/**
 * Consume authentication results only when provider ingestion supplies them and
 * the unique assertion is stamped by that provider's receiving service. Raw
 * `headers` are intentionally not accepted here: they are message content.
 */
export function verifyProviderSenderAuthentication(
  evidence: { provider: 'google' | 'microsoft'; authenticationResults: string[]; receivingAuthservId?: string; receivingAuthservIds?: string[] } | null | undefined,
  fromEmail: string | null | undefined
): SenderAuthResults | null {
  if (!evidence || !Array.isArray(evidence.authenticationResults) || evidence.authenticationResults.length === 0) return null;
  // RFC 8601 requires receivers to remove incoming fields claiming their own
  // authserv-id, then prepend the receiver's result. Trust only that first
  // ordered Authentication-Results field; never search transit results below.
  const assertion = evidence.authenticationResults[0];
  if (typeof assertion !== 'string' || !assertion.trim()) return null;
  const firstSegment = assertion.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const authservId = /^(?:spf|dkim|dmarc|arc|compauth)\s*=/.test(firstSegment) ? '' : firstSegment.split(/\s+/, 1)[0];
  const trusted = evidence.provider === 'google'
    ? authservId === 'mx.google.com'
    : evidence.provider === 'microsoft'
      // Exchange Online Authentication-Results commonly has no authserv-id.
      // Header Firewall strips inbound X-MS-Exchange-Organization-* fields;
      // AuthSource therefore identifies the Exchange server that stamped it.
      // Cover documented EOP and mailbox-server FQDN families.
      ? !authservId
        && (!evidence.receivingAuthservIds || evidence.receivingAuthservIds.length === 1)
        && isMicrosoftReceivingAuthSource(evidence.receivingAuthservIds?.[0] ?? evidence.receivingAuthservId)
      : false;
  if (!trusted) return null;
  return verifySenderAuthentication(assertion, fromEmail);
}

function isMicrosoftReceivingAuthSource(value: string | undefined): boolean {
  if (!value) return false;
  const hostname = value.trim().toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9.-]+$/.test(hostname) || hostname.includes('..')) return false;
  return hostname.endsWith('.mail.protection.outlook.com')
    || hostname.endsWith('.prod.protection.outlook.com')
    || hostname.endsWith('.prod.outlook.com');
}

export function allowsContactSenderAttribution(results: SenderAuthResults | null): boolean {
  return Boolean(results?.aligned.spf || results?.aligned.dkim);
}

/**
 * Exchange Online stamps `X-MS-Exchange-Organization-AuthAs: Internal` on mail that
 * was authenticated inside the receiving Microsoft 365 organization, and strips every
 * `X-MS-Exchange-Organization-*` header from mail arriving from outside it. Such mail
 * carries no Authentication-Results header (SPF/DKIM are never evaluated for
 * intra-tenant delivery), so it would otherwise fail the contact gate closed.
 * Only trust this for Microsoft providers: other MTAs do not strip the header.
 */
export function isMicrosoftIntraOrgSender(
  provider: string | null | undefined,
  headers: Record<string, string> | null | undefined
): boolean {
  if (provider !== 'microsoft' || !headers) return false;
  const authAs = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === 'x-ms-exchange-organization-authas'
  )?.[1];
  return typeof authAs === 'string' && authAs.trim().toLowerCase() === 'internal';
}
