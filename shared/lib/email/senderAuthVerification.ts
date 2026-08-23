import { extractEmailDomain } from './addressUtils';

export interface SenderAuthResults {
  spf: 'pass' | 'fail' | 'neutral' | 'none' | 'temperror' | 'permerror' | null;
  dkim: 'pass' | 'fail' | 'neutral' | 'none' | 'temperror' | 'permerror' | null;
  dmarc: 'pass' | 'fail' | 'neutral' | 'none' | 'temperror' | 'permerror' | null;
  aligned: { spf: boolean; dkim: boolean; dmarc: boolean };
}

const RESULT = /\b(spf|dkim|dmarc)\s*=\s*(pass|fail|neutral|none|temperror|permerror)\b([^;]*)/gi;

function domainAligned(candidate: string | undefined, fromDomain: string | null): boolean {
  if (!candidate || !fromDomain) return false;
  const domain = candidate.trim().replace(/[>;,)]+$/, '').toLowerCase();
  return domain === fromDomain || domain.endsWith(`.${fromDomain}`) || fromDomain.endsWith(`.${domain}`);
}

/**
 * Parses the Authentication-Results header added by the receiving MTA. Missing or
 * malformed headers deliberately return null: sender attribution must fail closed.
 * A single header is one authserv block; when callers supply multiple values, the
 * last value is the topmost (our-MTA) result per RFC 8601 handling policy.
 */
export function verifySenderAuthentication(
  authenticationResults: string | string[] | null | undefined,
  fromEmail: string | null | undefined
): SenderAuthResults | null {
  const blocks = Array.isArray(authenticationResults)
    ? authenticationResults.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : typeof authenticationResults === 'string' && authenticationResults.trim() ? [authenticationResults] : [];
  const block = blocks.at(-1);
  const fromDomain = extractEmailDomain(fromEmail ?? '')?.toLowerCase() ?? null;
  if (!block || !fromDomain) return null;

  const results: SenderAuthResults = {
    spf: null, dkim: null, dmarc: null,
    aligned: { spf: false, dkim: false, dmarc: false },
  };
  let match: RegExpExecArray | null;
  let found = false;
  while ((match = RESULT.exec(block))) {
    found = true;
    const mechanism = match[1].toLowerCase() as 'spf' | 'dkim' | 'dmarc';
    const verdict = match[2].toLowerCase() as NonNullable<SenderAuthResults[typeof mechanism]>;
    const properties = match[3] ?? '';
    results[mechanism] = verdict;
    const domain = mechanism === 'spf'
      ? properties.match(/\bsmtp\.mailfrom\s*=\s*([^\s;]+)/i)?.[1]
      : mechanism === 'dkim'
        ? properties.match(/\bheader\.d\s*=\s*([^\s;]+)/i)?.[1]
        : properties.match(/\bheader\.from\s*=\s*([^\s;]+)/i)?.[1];
    results.aligned[mechanism] = verdict === 'pass' && domainAligned(domain, fromDomain);
  }
  return found ? results : null;
}

export function allowsInternalSenderAttribution(results: SenderAuthResults | null): boolean {
  return Boolean(results?.aligned.dmarc || (results?.aligned.spf && results?.aligned.dkim));
}

export function allowsContactSenderAttribution(results: SenderAuthResults | null): boolean {
  return Boolean(results?.aligned.spf || results?.aligned.dkim);
}
