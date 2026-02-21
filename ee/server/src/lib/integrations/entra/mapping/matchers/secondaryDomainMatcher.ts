import { normalizeDomainValue } from './exactDomainMatcher';

export interface SecondaryDomainMatcherClient {
  clientId: string;
  clientName: string;
  secondaryDomains: string[];
}

export interface SecondaryDomainMatchCandidate {
  clientId: string;
  clientName: string;
  confidenceScore: number;
  matchedDomain: string;
  reason: 'secondary_domain';
}

export function findSecondaryDomainMatches(
  tenantDomain: string | null | undefined,
  clients: SecondaryDomainMatcherClient[]
): SecondaryDomainMatchCandidate[] {
  const normalizedTenantDomain = normalizeDomainValue(tenantDomain);
  if (!normalizedTenantDomain) {
    return [];
  }

  const matches: SecondaryDomainMatchCandidate[] = [];

  for (const client of clients) {
    for (const domain of client.secondaryDomains) {
      const normalizedSecondaryDomain = normalizeDomainValue(domain);
      if (!normalizedSecondaryDomain) {
        continue;
      }

      if (normalizedSecondaryDomain === normalizedTenantDomain) {
        matches.push({
          clientId: client.clientId,
          clientName: client.clientName,
          confidenceScore: 0.88,
          matchedDomain: normalizedSecondaryDomain,
          reason: 'secondary_domain',
        });
        break;
      }
    }
  }

  return matches;
}
