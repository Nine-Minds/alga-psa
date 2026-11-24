import { parseAuthenticationResults } from './authResultsChain';
import type { SenderAuthResults } from './authResultsChain';

// The comment-stripping and domain-alignment helpers live with the chain parser
// (authResultsChain.ts) and are re-exported so existing imports keep working.
export type { SenderAuthResults } from './authResultsChain';
export { stripComments, unfoldHeader, extractDomain, domainAligned, allowsContactSenderAttribution } from './authResultsChain';

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
  return parseAuthenticationResults(authenticationResults, fromEmail)[0]?.results ?? null;
}

export function allowsInternalSenderAttribution(results: SenderAuthResults | null): boolean {
  return Boolean(results?.aligned.dmarc || (results?.aligned.spf && results?.aligned.dkim));
}

/**
 * Exchange Online stamps `X-MS-Exchange-Organization-AuthAs: Internal` on mail that
 * was authenticated inside the receiving Microsoft 365 organization, and strips every
 * `X-MS-Exchange-Organization-*` header from mail arriving from outside it. Such mail
 * carries no Authentication-Results header (SPF/DKIM are never evaluated for
 * intra-tenant delivery), so it would otherwise fail both the contact gate and the
 * internal-user gate closed — the latter silently quarantining an MSP technician who
 * mails their own helpdesk mailbox about an existing ticket.
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
