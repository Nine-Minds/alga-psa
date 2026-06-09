/**
 * Hudu company↔client mapping (EE-only).
 *
 * Pure matcher + companies-cache shaping, plus knex-level persistence against
 * the SHARED CE table `tenant_external_entity_mappings` (HUDU_MAPPING_TABLE,
 * `integration_type='hudu'`, `alga_entity_type='client'`). Gating lives in
 * huduMappingActions.ts (system_settings) — deliberately NOT the
 * billing_settings-gated externalMappingActions wrappers (OQ3).
 *
 * One-to-one per tenant, both directions: the table's unique indexes cover
 * client→company (idx_unique_alga_mapping) and company→client
 * (idx_unique_external_mapping); setHuduCompanyMappingRow pre-checks both for
 * friendly typed errors and maps a racing 23505 to the same shape. Replace is
 * explicit clear+set only.
 */

import type { Knex } from 'knex';
import { HUDU_INTEGRATION_TYPE, HUDU_MAPPING_TABLE } from './contracts';
import type { HuduCompany } from './contracts';

export const HUDU_MAPPING_ENTITY_TYPE = 'client' as const;
export const HUDU_MAPPING_SYNC_STATUS = 'manual_link' as const;
export const HUDU_FUZZY_MATCH_THRESHOLD = 0.8;
export const HUDU_EXACT_NAME_CONFIDENCE = 0.9;
export const HUDU_INTEGRATION_ID_CONFIDENCE = 1.0;

// ============ Companies cache (hudu_integrations.settings.companies_cache) ============

export interface HuduCompanyCacheEntry {
  id: number;
  name: string;
  id_in_integration: string | null;
  url: string | null;
}

export interface HuduCompaniesCache {
  companies: HuduCompanyCacheEntry[];
  fetched_at: string;
}

export const HUDU_COMPANIES_CACHE_KEY = 'companies_cache' as const;

export function toCompanyCacheEntry(company: HuduCompany): HuduCompanyCacheEntry {
  const idInIntegration =
    company.id_in_integration === null ||
    company.id_in_integration === undefined ||
    String(company.id_in_integration).trim() === ''
      ? null
      : String(company.id_in_integration).trim();

  return {
    id: company.id,
    name: company.name,
    id_in_integration: idInIntegration,
    url: company.url ?? null,
  };
}

export function buildCompaniesCache(companies: HuduCompany[], fetchedAt?: Date): HuduCompaniesCache {
  return {
    companies: companies.map(toCompanyCacheEntry),
    fetched_at: (fetchedAt ?? new Date()).toISOString(),
  };
}

/** Read + shape-check the cache out of a hudu_integrations.settings blob. */
export function parseCompaniesCache(
  settings: Record<string, unknown> | null | undefined
): HuduCompaniesCache | null {
  const raw = settings?.[HUDU_COMPANIES_CACHE_KEY] as HuduCompaniesCache | undefined;
  if (!raw || !Array.isArray(raw.companies) || typeof raw.fetched_at !== 'string') {
    return null;
  }
  return raw;
}

// ============ Auto-suggest matcher (pure) ============

export type HuduSuggestionSource = 'integration_id' | 'exact_name' | 'fuzzy_name';

export interface HuduMappingSuggestion {
  client_id: string;
  client_name: string;
  source: HuduSuggestionSource;
  confidence: number;
}

export interface HuduMatcherClient {
  client_id: string;
  client_name: string;
}

/** Minimal existing-mapping reference for exclusion. */
export interface HuduExistingMappingRef {
  client_id: string;
  hudu_company_id: string | number;
}

/** Matcher input: a HuduCompany or a cache entry. */
export interface HuduMatcherCompany {
  id: number;
  name: string;
  id_in_integration?: string | number | null;
}

function normalizeName(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Two-row Levenshtein distance (dependency-free). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Normalized-Levenshtein name similarity in [0, 1]. */
export function huduNameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  return 1 - levenshtein(na, nb) / maxLen;
}

/**
 * Suggest a client for each unmapped Hudu company. Priority per company:
 * (1) id_in_integration string-equals a client_id → 'integration_id', 1.0;
 * (2) exact case-insensitive name → 'exact_name', 0.9;
 * (3) fuzzy name ≥ HUDU_FUZZY_MATCH_THRESHOLD → 'fuzzy_name', score.
 * Already-mapped companies get no suggestion; already-mapped clients are
 * excluded as targets; each client is claimed by at most one suggestion
 * (higher-priority/higher-score pass wins).
 */
export function suggestHuduCompanyMappings(
  companies: HuduMatcherCompany[],
  clients: HuduMatcherClient[],
  existingMappings: HuduExistingMappingRef[] = []
): Map<number, HuduMappingSuggestion> {
  const suggestions = new Map<number, HuduMappingSuggestion>();

  const mappedCompanyIds = new Set(existingMappings.map((m) => String(m.hudu_company_id)));
  const claimedClientIds = new Set(existingMappings.map((m) => m.client_id));

  const candidates = companies.filter((c) => !mappedCompanyIds.has(String(c.id)));
  const available = () => clients.filter((c) => !claimedClientIds.has(c.client_id));

  const claim = (companyId: number, client: HuduMatcherClient, source: HuduSuggestionSource, confidence: number) => {
    suggestions.set(companyId, {
      client_id: client.client_id,
      client_name: client.client_name,
      source,
      confidence: Number(confidence.toFixed(4)),
    });
    claimedClientIds.add(client.client_id);
  };

  // Pass 1: id_in_integration exact-equals an Alga client_id.
  for (const company of candidates) {
    if (suggestions.has(company.id)) continue;
    const psaId =
      company.id_in_integration === null || company.id_in_integration === undefined
        ? ''
        : String(company.id_in_integration).trim().toLowerCase();
    if (!psaId) continue;
    const match = available().find((c) => c.client_id.toLowerCase() === psaId);
    if (match) claim(company.id, match, 'integration_id', HUDU_INTEGRATION_ID_CONFIDENCE);
  }

  // Pass 2: exact case-insensitive name.
  for (const company of candidates) {
    if (suggestions.has(company.id)) continue;
    const name = company.name.trim().toLowerCase();
    if (!name) continue;
    const match = available().find((c) => c.client_name.trim().toLowerCase() === name);
    if (match) claim(company.id, match, 'exact_name', HUDU_EXACT_NAME_CONFIDENCE);
  }

  // Pass 3: fuzzy name ≥ threshold, best pairs first (greedy one-to-one).
  const fuzzyPairs: Array<{ company: HuduMatcherCompany; client: HuduMatcherClient; score: number }> = [];
  for (const company of candidates) {
    if (suggestions.has(company.id)) continue;
    for (const client of available()) {
      const score = huduNameSimilarity(company.name, client.client_name);
      if (score >= HUDU_FUZZY_MATCH_THRESHOLD) {
        fuzzyPairs.push({ company, client, score });
      }
    }
  }
  fuzzyPairs.sort((a, b) => b.score - a.score);
  for (const pair of fuzzyPairs) {
    if (suggestions.has(pair.company.id) || claimedClientIds.has(pair.client.client_id)) continue;
    claim(pair.company.id, pair.client, 'fuzzy_name', pair.score);
  }

  return suggestions;
}

// ============ Persistence (shared CE table, knex-level) ============

export interface HuduMappingMetadata {
  hudu_company_name?: string | null;
  id_in_integration?: string | null;
  url?: string | null;
}

export interface HuduCompanyMappingRow {
  id: string;
  tenant: string;
  integration_type: string;
  alga_entity_type: string;
  alga_entity_id: string;
  external_entity_id: string;
  external_realm_id: string | null;
  sync_status: string | null;
  last_synced_at: Date | string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export type HuduMappingErrorCode =
  | 'client_already_mapped'
  | 'company_already_mapped'
  | 'mapping_conflict'
  | 'not_found';

export type HuduMappingWriteResult =
  | { ok: true; mapping: HuduCompanyMappingRow }
  | { ok: false; code: HuduMappingErrorCode; message: string };

export interface SetHuduCompanyMappingInput {
  clientId: string;
  huduCompanyId: string | number;
  metadata?: HuduMappingMetadata;
}

const huduMappingScope = { integration_type: HUDU_INTEGRATION_TYPE, alga_entity_type: HUDU_MAPPING_ENTITY_TYPE };

/**
 * Create a mapping row. Rejects (typed) when the client OR the Hudu company is
 * already mapped for this tenant — replace requires an explicit clear first.
 */
export async function setHuduCompanyMappingRow(
  knex: Knex,
  tenant: string,
  input: SetHuduCompanyMappingInput
): Promise<HuduMappingWriteResult> {
  const externalId = String(input.huduCompanyId);

  const clientTaken = await knex(HUDU_MAPPING_TABLE)
    .where({ tenant, ...huduMappingScope, alga_entity_id: input.clientId })
    .first('id', 'external_entity_id');
  if (clientTaken) {
    return {
      ok: false,
      code: 'client_already_mapped',
      message: `Client is already mapped to Hudu company ${clientTaken.external_entity_id}. Clear that mapping first.`,
    };
  }

  const companyTaken = await knex(HUDU_MAPPING_TABLE)
    .where({ tenant, ...huduMappingScope, external_entity_id: externalId })
    .first('id', 'alga_entity_id');
  if (companyTaken) {
    return {
      ok: false,
      code: 'company_already_mapped',
      message: `Hudu company ${externalId} is already mapped to another client. Clear that mapping first.`,
    };
  }

  try {
    const [row] = await knex(HUDU_MAPPING_TABLE)
      .insert({
        tenant,
        ...huduMappingScope,
        alga_entity_id: input.clientId,
        external_entity_id: externalId,
        external_realm_id: null,
        sync_status: HUDU_MAPPING_SYNC_STATUS,
        metadata: JSON.stringify({
          hudu_company_name: input.metadata?.hudu_company_name ?? null,
          id_in_integration: input.metadata?.id_in_integration ?? null,
          url: input.metadata?.url ?? null,
        }),
      })
      .returning('*');
    return { ok: true, mapping: row as HuduCompanyMappingRow };
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') {
      return {
        ok: false,
        code: 'mapping_conflict',
        message: 'This client or Hudu company was just mapped by someone else. Refresh and try again.',
      };
    }
    throw error;
  }
}

export interface ClearHuduCompanyMappingRef {
  mappingId?: string;
  huduCompanyId?: string | number;
}

/** Delete a mapping row by mapping id or by Hudu company id. Returns rows cleared. */
export async function clearHuduCompanyMappingRow(
  knex: Knex,
  tenant: string,
  ref: ClearHuduCompanyMappingRef
): Promise<number> {
  if (!ref.mappingId && ref.huduCompanyId === undefined) {
    throw new Error('clearHuduCompanyMappingRow requires mappingId or huduCompanyId');
  }

  const query = knex(HUDU_MAPPING_TABLE).where({ tenant, ...huduMappingScope });
  if (ref.mappingId) {
    query.andWhere({ id: ref.mappingId });
  } else {
    query.andWhere({ external_entity_id: String(ref.huduCompanyId) });
  }
  return query.del();
}

/** All Hudu client mappings for the tenant, with the mapped client's name joined on. */
export async function getHuduCompanyMappingRows(
  knex: Knex,
  tenant: string
): Promise<Array<HuduCompanyMappingRow & { client_name: string | null }>> {
  return knex(`${HUDU_MAPPING_TABLE} as m`)
    .leftJoin('clients as c', function joinClients() {
      this.on('c.tenant', '=', 'm.tenant').andOn(knex.raw('c.client_id::text = m.alga_entity_id'));
    })
    .where({ 'm.tenant': tenant, 'm.integration_type': HUDU_INTEGRATION_TYPE, 'm.alga_entity_type': HUDU_MAPPING_ENTITY_TYPE })
    .select('m.*', 'c.client_name as client_name');
}

// ============ Resolvers (F046) ============

export async function resolveHuduCompanyIdForClient(
  knex: Knex,
  tenant: string,
  clientId: string
): Promise<string | null> {
  const row = await knex(HUDU_MAPPING_TABLE)
    .where({ tenant, ...huduMappingScope, alga_entity_id: clientId })
    .first('external_entity_id');
  return row?.external_entity_id ?? null;
}

export async function resolveClientIdForHuduCompany(
  knex: Knex,
  tenant: string,
  huduCompanyId: string | number
): Promise<string | null> {
  const row = await knex(HUDU_MAPPING_TABLE)
    .where({ tenant, ...huduMappingScope, external_entity_id: String(huduCompanyId) })
    .first('alga_entity_id');
  return row?.alga_entity_id ?? null;
}
