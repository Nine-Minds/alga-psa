import { extractEmailDomain } from './addressUtils';

/**
 * Authentication-chain evaluation for inbound sender attribution.
 *
 * `Authentication-Results` (RFC 8601) blocks name the host that produced them
 * (the authserv-id), and `ARC-*` header sets (RFC 8617) let a forwarding gateway
 * seal what it saw. Any sender can write either header into a message, so a
 * block is only believed on stated evidence: the receiving MTA's own (topmost)
 * block, or an ARC set whose seal verified cryptographically and whose sealing
 * domain matches the authserv-id the tenant chose to trust.
 *
 * This module is pure: DNS / signature verification happens where the raw MIME
 * is available and only its verdict (`ArcSealVerdict`) is passed in.
 */

export type AuthVerdict = 'pass' | 'fail' | 'neutral' | 'none' | 'temperror' | 'permerror';

export interface SenderAuthResults {
  spf: AuthVerdict | null;
  dkim: AuthVerdict | null;
  dmarc: AuthVerdict | null;
  aligned: { spf: boolean; dkim: boolean; dmarc: boolean };
}

export interface AuthServBlock {
  /** Lower-cased authserv-id (`mx.avanan.net`), null when the block does not name one. */
  authservId: string | null;
  raw: string;
  /** Null when the block carries no spf/dkim/dmarc result at all. */
  results: SenderAuthResults | null;
  /** The block's own `arc=` verdict (set by an MTA that validated an ARC chain). */
  arc: AuthVerdict | null;
}

export interface ArcSet {
  instance: number;
  /** Lower-cased authserv-id of the ARC-Authentication-Results set. */
  authservId: string | null;
  /** `d=` of the ARC-Seal with the same instance, lower-cased. */
  sealDomain: string | null;
  results: SenderAuthResults | null;
}

export interface ArcHeaders {
  authenticationResults?: string | string[] | null;
  seal?: string | string[] | null;
}

export interface ArcSealVerdict {
  /** Chain-validation verdict from cryptographic verification of the raw message. */
  cv: 'pass' | 'fail' | 'none';
  /** authserv-id of the newest ARC-Authentication-Results set (diagnostic). */
  sealingAuthservId: string | null;
}

export type InboundAuthTrustMode = 'off' | 'arc-sealed' | 'mta-arc-pass';

export interface InboundAuthTrustPolicy {
  mode: InboundAuthTrustMode;
  trustedAuthservIds: string[];
}

export type ContactAttributionSource = 'mta' | 'gateway-arc' | 'mta-arc-pass' | 'none';

export interface ContactAttributionDecision {
  trusted: boolean;
  source: ContactAttributionSource;
  reason: string;
}

export const INBOUND_AUTH_TRUST_MODES: readonly InboundAuthTrustMode[] = ['off', 'arc-sealed', 'mta-arc-pass'];
export const DEFAULT_INBOUND_AUTH_TRUST: InboundAuthTrustPolicy = { mode: 'off', trustedAuthservIds: [] };

const RESULT = /\b(spf|dkim|dmarc)\s*=\s*(pass|fail|neutral|none|temperror|permerror)\b([^;]*)/gi;
const ARC_RESULT = /(?:^|[\s;])arc\s*=\s*(pass|fail|neutral|none|temperror|permerror)\b/i;

/**
 * Unfolds RFC 5322 continuation lines (a CRLF followed by whitespace continues
 * the previous header line) so a folded Authentication-Results header is parsed
 * as a single authserv block.
 */
export function unfoldHeader(value: string): string {
  return value.replace(/\r?\n[ \t]+/g, ' ');
}

/**
 * Strips RFC 8601 parenthesized comments from a header block. Comment text must
 * not feed mechanism/property matching (e.g. the `spf=pass dmarc=pass` tokens
 * Google nests inside `arc=pass (...)` or its free-text SPF comment).
 * Repeatedly removes innermost `(…)` spans until none remain, which handles
 * balanced nesting without a full recursive parser.
 */
export function stripComments(value: string): string {
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
export function extractDomain(value: string | undefined): string {
  if (!value) return '';
  const atIndex = value.lastIndexOf('@');
  const withoutLocalPart = atIndex >= 0 ? value.slice(atIndex + 1) : value;
  return withoutLocalPart.trim().replace(/[>;,)]+$/, '').toLowerCase();
}

export function domainAligned(candidate: string | undefined, fromDomain: string | null): boolean {
  if (!candidate || !fromDomain) return false;
  const domain = extractDomain(candidate);
  return domain === fromDomain || domain.endsWith(`.${fromDomain}`);
}

function fromDomainOf(fromEmail: string | null | undefined): string | null {
  return extractEmailDomain(fromEmail ?? '')?.toLowerCase() ?? null;
}

/** Splits a header value (string, or array of repeated headers) into its non-empty, unfolded blocks. */
function toBlocks(values: string | string[] | null | undefined): string[] {
  // Multiple values are multiple blocks; a single string may still fold across
  // physical lines, so unfold continuation lines first, then split on remaining
  // newlines (callers join repeated headers with "\n" in wire order).
  const rawBlocks = Array.isArray(values)
    ? values
    : typeof values === 'string' && values.trim()
      ? unfoldHeader(values).split(/\r?\n/)
      : [];
  return rawBlocks
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(unfoldHeader);
}

/** spf/dkim/dmarc results of one comment-free block, with alignment recomputed against the From domain. */
function parseMechanismResults(commentFree: string, fromDomain: string | null): SenderAuthResults | null {
  const results: SenderAuthResults = {
    spf: null, dkim: null, dmarc: null,
    aligned: { spf: false, dkim: false, dmarc: false },
  };
  let match: RegExpExecArray | null;
  let found = false;
  RESULT.lastIndex = 0;
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

function authservIdOf(commentFree: string): string | null {
  const first = commentFree.split(';')[0]?.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return first && !first.includes('=') ? first : null;
}

/**
 * Parses every Authentication-Results block in header order (index 0 is the
 * topmost, i.e. the receiving MTA's own). Alignment is always recomputed per
 * block against the From domain; a block's own `header.from` claim is never
 * trusted on its own. Returns [] when there is no From domain to align against.
 * Malformed or missing headers deliberately yield no blocks: attribution fails closed.
 */
export function parseAuthenticationResults(
  values: string | string[] | null | undefined,
  fromEmail: string | null | undefined
): AuthServBlock[] {
  const fromDomain = fromDomainOf(fromEmail);
  if (!fromDomain) return [];
  return toBlocks(values).map((raw) => {
    // Drop parenthesized comments before mechanism matching so comment text
    // (e.g. the `spf=pass dmarc=pass` tokens inside Google's `arc=pass (...)` or
    // its free-text SPF comment) cannot fabricate results.
    const commentFree = stripComments(raw);
    return {
      authservId: authservIdOf(commentFree),
      raw,
      results: parseMechanismResults(commentFree, fromDomain),
      arc: (commentFree.match(ARC_RESULT)?.[1]?.toLowerCase() as AuthVerdict | undefined) ?? null,
    };
  });
}

function parseInstance(commentFree: string): number | null {
  const match = commentFree.match(/(?:^|[\s;])i\s*=\s*(\d+)/i);
  const instance = match ? Number(match[1]) : NaN;
  return Number.isInteger(instance) && instance >= 1 ? instance : null;
}

/**
 * Parses ARC-Authentication-Results sets ordered by `i=` (oldest hop first),
 * comments stripped, each paired with the `d=` of its ARC-Seal. Sets with no
 * usable `i=` are ignored.
 */
export function parseArcAuthenticationResults(
  headers: ArcHeaders | null | undefined,
  fromEmail: string | null | undefined
): ArcSet[] {
  const fromDomain = fromDomainOf(fromEmail);
  if (!fromDomain || !headers) return [];

  const sealDomains = new Map<number, string>();
  for (const seal of toBlocks(headers.seal)) {
    const commentFree = stripComments(seal);
    const instance = parseInstance(commentFree);
    const domain = commentFree.match(/(?:^|[\s;])d\s*=\s*([^\s;]+)/i)?.[1]?.toLowerCase();
    if (instance !== null && domain && !sealDomains.has(instance)) sealDomains.set(instance, domain);
  }

  const sets: ArcSet[] = [];
  for (const raw of toBlocks(headers.authenticationResults)) {
    const commentFree = stripComments(raw);
    const instance = parseInstance(commentFree);
    if (instance === null) continue;
    // Drop the leading `i=N;` tag so the authserv-id is the next token.
    const afterInstance = commentFree.replace(/^\s*i\s*=\s*\d+\s*;?/i, '');
    sets.push({
      instance,
      authservId: authservIdOf(afterInstance),
      sealDomain: sealDomains.get(instance) ?? null,
      results: parseMechanismResults(afterInstance, fromDomain),
    });
  }
  return sets.sort((a, b) => a.instance - b.instance);
}

/** Today's contact rule: an aligned SPF or DKIM pass. */
export function allowsContactSenderAttribution(results: SenderAuthResults | null): boolean {
  return Boolean(results?.aligned.spf || results?.aligned.dkim);
}

/** Normalizes a stored `inbound_auth_trust` value; anything unrecognised is `off`. */
export function normalizeInboundAuthTrust(raw: unknown): InboundAuthTrustPolicy {
  let value: unknown = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  if (!value || typeof value !== 'object') return { ...DEFAULT_INBOUND_AUTH_TRUST };
  const candidate = value as { mode?: unknown; trustedAuthservIds?: unknown };
  const mode = INBOUND_AUTH_TRUST_MODES.find((m) => m === candidate.mode) ?? 'off';
  const ids = Array.isArray(candidate.trustedAuthservIds) ? candidate.trustedAuthservIds : [];
  const trustedAuthservIds = Array.from(new Set(
    ids
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean)
  ));
  return { mode, trustedAuthservIds };
}

/**
 * An authserv-id is only attributable to the party that sealed the set when the
 * seal's signing domain is the authserv-id or a parent of it. Without this an
 * attacker could seal their own chain with their own key while naming
 * `mx.avanan.net` as the authserv-id.
 */
function sealBindsAuthservId(set: ArcSet): boolean {
  if (!set.authservId || !set.sealDomain) return false;
  return set.authservId === set.sealDomain || set.authservId.endsWith(`.${set.sealDomain}`);
}

function findTrustedAlignedArcSet(arcSets: ArcSet[], trusted: Set<string>): ArcSet | null {
  return arcSets.find((set) =>
    set.authservId !== null &&
    trusted.has(set.authservId) &&
    sealBindsAuthservId(set) &&
    allowsContactSenderAttribution(set.results)
  ) ?? null;
}

export interface EvaluateContactAttributionInput {
  blocks: AuthServBlock[];
  arcSets: ArcSet[];
  arcSeal?: ArcSealVerdict | null;
  policy?: InboundAuthTrustPolicy | null;
}

/**
 * Decides whether the sender's authentication may attribute the message to a
 * known *contact* (never to an internal user). Rules, in order:
 *  1. `mta`          the receiving MTA's topmost block has an aligned spf/dkim pass;
 *  2. `gateway-arc`  (mode arc-sealed) the ARC chain verified `cv=pass`, and a set from
 *                    a trusted authserv-id, bound to its sealing domain, shows an
 *                    aligned spf/dkim pass;
 *  3. `mta-arc-pass` (mode mta-arc-pass) the MTA's own block says `arc=pass` and the same
 *                    trusted, bound, aligned set exists in the chain it validated;
 *  4. `none`.
 * A lower Authentication-Results block is never sufficient by itself.
 */
export function evaluateContactAttribution(input: EvaluateContactAttributionInput): ContactAttributionDecision {
  const policy = input.policy ?? DEFAULT_INBOUND_AUTH_TRUST;
  const top = input.blocks[0] ?? null;

  if (top && allowsContactSenderAttribution(top.results)) {
    return { trusted: true, source: 'mta', reason: 'receiving MTA reports aligned spf/dkim pass' };
  }

  const trustedIds = new Set(policy.trustedAuthservIds.map((id) => id.trim().toLowerCase()).filter(Boolean));

  if (policy.mode === 'arc-sealed') {
    if (trustedIds.size === 0) return { trusted: false, source: 'none', reason: 'arc-sealed mode has no trusted authserv-ids configured' };
    if (input.arcSeal?.cv !== 'pass') {
      return { trusted: false, source: 'none', reason: `ARC seal not verified (cv=${input.arcSeal?.cv ?? 'none'})` };
    }
    const set = findTrustedAlignedArcSet(input.arcSets, trustedIds);
    if (set) {
      return {
        trusted: true,
        source: 'gateway-arc',
        reason: `verified ARC chain; ${set.authservId} (i=${set.instance}) reports aligned spf/dkim pass`,
      };
    }
    return { trusted: false, source: 'none', reason: 'no trusted, seal-bound ARC set with aligned spf/dkim pass' };
  }

  if (policy.mode === 'mta-arc-pass') {
    if (trustedIds.size === 0) return { trusted: false, source: 'none', reason: 'mta-arc-pass mode has no trusted authserv-ids configured' };
    if (top?.arc !== 'pass') return { trusted: false, source: 'none', reason: 'receiving MTA did not report arc=pass' };
    const set = findTrustedAlignedArcSet(input.arcSets, trustedIds);
    if (set) {
      return {
        trusted: true,
        source: 'mta-arc-pass',
        reason: `receiving MTA validated ARC; ${set.authservId} (i=${set.instance}) reports aligned spf/dkim pass`,
      };
    }
    return { trusted: false, source: 'none', reason: 'no trusted, seal-bound ARC set with aligned spf/dkim pass' };
  }

  return { trusted: false, source: 'none', reason: 'no aligned spf/dkim pass from the receiving MTA' };
}
