import { createTenantKnex, runWithTenant } from '@/lib/db';
import { mapEntraManagedTenantRow } from '../entraRowMappers';
import {
  extractDomainFromEmailOrUrl,
  findExactDomainMatches,
  type ExactDomainMatcherClient,
} from './matchers/exactDomainMatcher';
import {
  findSecondaryDomainMatches,
  type SecondaryDomainMatcherClient,
} from './matchers/secondaryDomainMatcher';
import {
  findFuzzyClientCandidates,
  type FuzzyMatcherClient,
} from './matchers/fuzzyMatcher';

interface PreviewTenant {
  managedTenantId: string;
  entraTenantId: string;
  displayName: string | null;
  primaryDomain: string | null;
  sourceUserCount: number;
}

interface PreviewCandidate {
  clientId: string;
  clientName: string;
  confidenceScore: number;
  reason: 'exact_domain' | 'secondary_domain' | 'fuzzy_name';
  matchedDomain?: string;
  autoMatch?: false;
}

export interface EntraMappingPreviewResult {
  autoMatched: Array<PreviewTenant & { match: PreviewCandidate }>;
  fuzzyCandidates: Array<PreviewTenant & { candidates: PreviewCandidate[] }>;
  unmatched: PreviewTenant[];
}

interface ClientRow {
  client_id: string;
  client_name: string;
  url: string | null;
  properties: Record<string, unknown> | null;
  billing_email: string | null;
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function buildDomainCandidates(
  clients: ClientRow[],
  inboundDomainsByClient: Map<string, string[]>
): {
  exactClients: ExactDomainMatcherClient[];
  secondaryClients: SecondaryDomainMatcherClient[];
  fuzzyClients: FuzzyMatcherClient[];
} {
  const exactClients: ExactDomainMatcherClient[] = [];
  const secondaryClients: SecondaryDomainMatcherClient[] = [];
  const fuzzyClients: FuzzyMatcherClient[] = [];

  for (const client of clients) {
    const properties = toObject(client.properties);

    const primaryDomainSet = new Set<string>();
    const secondaryDomainSet = new Set<string>();

    const primaryDomains = [
      extractDomainFromEmailOrUrl(client.url),
      extractDomainFromEmailOrUrl(typeof properties.website === 'string' ? properties.website : null),
      extractDomainFromEmailOrUrl(typeof properties.domain === 'string' ? properties.domain : null),
    ].filter((value): value is string => Boolean(value));

    for (const domain of primaryDomains) {
      primaryDomainSet.add(domain);
    }

    const secondaryDomains = [
      extractDomainFromEmailOrUrl(client.billing_email),
      extractDomainFromEmailOrUrl(
        typeof properties.emailDomain === 'string' ? properties.emailDomain : null
      ),
      ...((inboundDomainsByClient.get(client.client_id) || []).map((domain) =>
        extractDomainFromEmailOrUrl(domain)
      )),
    ].filter((value): value is string => Boolean(value));

    for (const domain of secondaryDomains) {
      secondaryDomainSet.add(domain);
    }

    exactClients.push({
      clientId: client.client_id,
      clientName: client.client_name,
      primaryDomains: Array.from(primaryDomainSet),
    });

    secondaryClients.push({
      clientId: client.client_id,
      clientName: client.client_name,
      secondaryDomains: Array.from(secondaryDomainSet),
    });

    fuzzyClients.push({
      clientId: client.client_id,
      clientName: client.client_name,
    });
  }

  return { exactClients, secondaryClients, fuzzyClients };
}

export async function buildEntraMappingPreview(
  tenant: string
): Promise<EntraMappingPreviewResult> {
  const { managedTenants, clients, inboundDomains } = await runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex();

    const [managedTenantRows, clientRows, inboundDomainRows] = await Promise.all([
      knex('entra_managed_tenants')
        .where({ tenant })
        .orderByRaw('coalesce(display_name, entra_tenant_id) asc')
        .select('*'),
      knex('clients')
        .where({ tenant })
        .select('client_id', 'client_name', 'url', 'properties', 'billing_email'),
      knex('client_inbound_email_domains')
        .where({ tenant })
        .select('client_id', 'domain'),
    ]);

    return {
      managedTenants: managedTenantRows,
      clients: clientRows as ClientRow[],
      inboundDomains: inboundDomainRows as Array<{ client_id: string; domain: string }>,
    };
  });

  const inboundDomainsByClient = new Map<string, string[]>();
  for (const row of inboundDomains) {
    const current = inboundDomainsByClient.get(row.client_id) || [];
    current.push(row.domain);
    inboundDomainsByClient.set(row.client_id, current);
  }

  const { exactClients, secondaryClients, fuzzyClients } = buildDomainCandidates(
    clients,
    inboundDomainsByClient
  );

  const autoMatched: Array<PreviewTenant & { match: PreviewCandidate }> = [];
  const fuzzyCandidates: Array<PreviewTenant & { candidates: PreviewCandidate[] }> = [];
  const unmatched: PreviewTenant[] = [];

  for (const rawManagedTenant of managedTenants) {
    const mapped = mapEntraManagedTenantRow(rawManagedTenant as Record<string, unknown>);
    const tenantPreview: PreviewTenant = {
      managedTenantId: mapped.managed_tenant_id,
      entraTenantId: mapped.entra_tenant_id,
      displayName: mapped.display_name,
      primaryDomain: mapped.primary_domain,
      sourceUserCount: mapped.source_user_count,
    };

    const exactMatches = findExactDomainMatches(mapped.primary_domain, exactClients);
    if (exactMatches.length === 1) {
      const exactMatch = exactMatches[0];
      autoMatched.push({
        ...tenantPreview,
        match: {
          clientId: exactMatch.clientId,
          clientName: exactMatch.clientName,
          confidenceScore: exactMatch.confidenceScore,
          reason: exactMatch.reason,
          matchedDomain: exactMatch.matchedDomain,
        },
      });
      continue;
    }

    const candidateByClient = new Map<string, PreviewCandidate>();

    for (const exactMatch of exactMatches) {
      candidateByClient.set(exactMatch.clientId, {
        clientId: exactMatch.clientId,
        clientName: exactMatch.clientName,
        confidenceScore: exactMatch.confidenceScore,
        reason: exactMatch.reason,
        matchedDomain: exactMatch.matchedDomain,
      });
    }

    const secondaryMatches = findSecondaryDomainMatches(mapped.primary_domain, secondaryClients);
    for (const secondaryMatch of secondaryMatches) {
      const existing = candidateByClient.get(secondaryMatch.clientId);
      if (!existing || secondaryMatch.confidenceScore > existing.confidenceScore) {
        candidateByClient.set(secondaryMatch.clientId, {
          clientId: secondaryMatch.clientId,
          clientName: secondaryMatch.clientName,
          confidenceScore: secondaryMatch.confidenceScore,
          reason: secondaryMatch.reason,
          matchedDomain: secondaryMatch.matchedDomain,
        });
      }
    }

    const fuzzyMatches = findFuzzyClientCandidates(mapped.display_name, fuzzyClients);
    for (const fuzzyMatch of fuzzyMatches) {
      const existing = candidateByClient.get(fuzzyMatch.clientId);
      if (!existing || fuzzyMatch.confidenceScore > existing.confidenceScore) {
        candidateByClient.set(fuzzyMatch.clientId, {
          clientId: fuzzyMatch.clientId,
          clientName: fuzzyMatch.clientName,
          confidenceScore: fuzzyMatch.confidenceScore,
          reason: fuzzyMatch.reason,
          autoMatch: false,
        });
      }
    }

    const candidates = Array.from(candidateByClient.values()).sort(
      (a, b) => b.confidenceScore - a.confidenceScore
    );

    if (candidates.length > 0) {
      fuzzyCandidates.push({
        ...tenantPreview,
        candidates,
      });
    } else {
      unmatched.push(tenantPreview);
    }
  }

  return {
    autoMatched,
    fuzzyCandidates,
    unmatched,
  };
}
