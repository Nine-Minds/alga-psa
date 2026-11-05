import { dkimVerify, type DKIMVerifyOptions } from 'mailauth';
import type { SenderAuthenticationEvidence, SenderContactEvidence } from '../../interfaces/inbound-email.interfaces';

export interface VerifiedDkimEvidence {
  verified: boolean;
  alignedDomains: string[];
  reason: 'aligned_signature' | 'no_aligned_signature' | 'partially_unsigned_body' | 'verification_error';
}

export function contactDkimAuthorization(dkim: VerifiedDkimEvidence): SenderContactEvidence {
  return dkim.verified
    ? { authorization: 'domain_only', provenance: 'aligned_original_mime_dkim', alignedDomains: dkim.alignedDomains }
    : { authorization: 'untrusted', provenance: 'missing_or_invalid_dkim', alignedDomains: [] };
}

/** Verify signatures over the original RFC 822 bytes using DNS-published keys.
 * A passing aligned signature authenticates domain control and signed content;
 * it deliberately does not establish which mailbox authored the message.
 */
export async function verifyOriginalMimeDkim(
  rawMime: Buffer,
  fromEmail: string | null | undefined,
  resolver?: DKIMVerifyOptions['resolver'],
): Promise<VerifiedDkimEvidence> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const verified = await Promise.race([
      dkimVerify(rawMime, { strict: true, rejectRsaSha1: true, resolver }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('dkim_dns_timeout')), 5_000);
      }),
    ]);
    const requestedFrom = String(fromEmail ?? '').trim().toLowerCase();
    const signedFromMatches = verified.headerFrom.some((address) => address.trim().toLowerCase() === requestedFrom);
    const alignedResults = (signedFromMatches ? verified.results : [])
      .filter((result) => result.status.result === 'pass' && result.status.aligned && result.signingDomain);
    const alignedDomains = alignedResults
      .filter((result) => result.status.underSized === undefined
        || result.status.underSized === 0)
      .map((result) => result.signingDomain!.toLowerCase())
      .filter((domain) => Boolean(fromEmail) && Boolean(domain));
    if (alignedDomains.length) {
      return { verified: true, alignedDomains: [...new Set(alignedDomains)], reason: 'aligned_signature' };
    }
    return alignedResults.some((result) => typeof result.status.underSized === 'number' && result.status.underSized > 0)
      ? { verified: false, alignedDomains: [], reason: 'partially_unsigned_body' }
      : { verified: false, alignedDomains: [], reason: 'no_aligned_signature' };
  } catch {
    return { verified: false, alignedDomains: [], reason: 'verification_error' };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Retain repeated provider claims in wire order for diagnostics; never authorize from them. */
export function orderedAuthenticationResults(headers: Array<{ name?: unknown; value?: unknown }>): string[] {
  return headers
    .filter((header) => String(header?.name ?? '').toLowerCase() === 'authentication-results')
    .map((header) => header.value)
    .filter((value): value is string => typeof value === 'string');
}

export function isInternalAttributionTrusted(
  decision: SenderAuthenticationEvidence | null | undefined
): boolean {
  return decision?.author?.authorization === 'internal_actor_attribution'
    && decision.author.provenance === 'provider_attested_author';
}
