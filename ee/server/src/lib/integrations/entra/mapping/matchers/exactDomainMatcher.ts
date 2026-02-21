export interface ExactDomainMatcherClient {
  clientId: string;
  clientName: string;
  primaryDomains: string[];
}

export interface ExactDomainMatchCandidate {
  clientId: string;
  clientName: string;
  confidenceScore: number;
  matchedDomain: string;
  reason: 'exact_domain';
}

export function normalizeDomainValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  let normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  normalized = normalized
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');

  if (!normalized.includes('.')) {
    return null;
  }

  return normalized;
}

export function extractDomainFromEmailOrUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const raw = value.trim();
  if (!raw) {
    return null;
  }

  const atIndex = raw.lastIndexOf('@');
  if (atIndex > -1 && atIndex < raw.length - 1) {
    return normalizeDomainValue(raw.slice(atIndex + 1));
  }

  return normalizeDomainValue(raw);
}

export function findExactDomainMatches(
  tenantDomain: string | null | undefined,
  clients: ExactDomainMatcherClient[]
): ExactDomainMatchCandidate[] {
  const normalizedTenantDomain = normalizeDomainValue(tenantDomain);
  if (!normalizedTenantDomain) {
    return [];
  }

  const matches: ExactDomainMatchCandidate[] = [];

  for (const client of clients) {
    for (const domain of client.primaryDomains) {
      const normalizedClientDomain = normalizeDomainValue(domain);
      if (!normalizedClientDomain) {
        continue;
      }

      if (normalizedClientDomain === normalizedTenantDomain) {
        matches.push({
          clientId: client.clientId,
          clientName: client.clientName,
          confidenceScore: 1,
          matchedDomain: normalizedClientDomain,
          reason: 'exact_domain',
        });
        break;
      }
    }
  }

  return matches;
}
