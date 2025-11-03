import { getConnection } from '@/lib/db/db';
import type {
  DuplicateCheckResult,
  DuplicateDetectionStrategy,
  ParsedRecord
} from '@/types/imports.types';
import type { Knex } from 'knex';

const MAX_FUZZY_CANDIDATES = 25;
const DEFAULT_FUZZY_THRESHOLD = 0.82;

type ExactMatchResolver = (
  knex: Knex,
  tenantId: string,
  value: string
) => Promise<string | null>;

const exactResolvers: Record<string, ExactMatchResolver> = {
  serial_number: async (knex, tenantId, value) => {
    const match = await knex<{ asset_id: string }>('assets')
      .select('asset_id')
      .where('tenant', tenantId)
      .whereRaw('serial_number IS NOT NULL')
      .andWhere('serial_number', value)
      .first();
    return match?.asset_id ?? null;
  },
  asset_tag: async (knex, tenantId, value) => {
    const match = await knex<{ asset_id: string }>('assets')
      .select('asset_id')
      .where('tenant', tenantId)
      .whereRaw('asset_tag IS NOT NULL')
      .andWhere('asset_tag', value)
      .first();
    return match?.asset_id ?? null;
  },
  hostname: async (knex, tenantId, value) => {
    const match = await knex<{ asset_id: string }>('assets')
      .select('asset_id')
      .where('tenant', tenantId)
      .whereRaw('name IS NOT NULL')
      .andWhereRaw('LOWER(name) = LOWER(?)', [value])
      .first();
    return match?.asset_id ?? null;
  },
  name: async (knex, tenantId, value) => {
    const match = await knex<{ asset_id: string }>('assets')
      .select('asset_id')
      .where('tenant', tenantId)
      .whereRaw('name IS NOT NULL')
      .andWhereRaw('LOWER(name) = LOWER(?)', [value])
      .first();
    return match?.asset_id ?? null;
  },
  mac_address: async (knex, tenantId, value) => {
    const match = await knex<{ asset_id: string }>('assets')
      .select('asset_id')
      .where('tenant', tenantId)
      .andWhere((builder) => {
        builder.whereRaw(
          `
            LOWER(
              regexp_replace(
                COALESCE(attributes->>'mac_address', ''),
                '[^0-9A-Fa-f]',
                '',
                'g'
              )
            ) = ?
          `,
          [value]
        );

        builder.orWhereRaw(
          `
            LOWER(
              regexp_replace(
                COALESCE(attributes->>'primary_mac', ''),
                '[^0-9A-Fa-f]',
                '',
                'g'
              )
            ) = ?
          `,
          [value]
        );

        builder.orWhereRaw(
          `
            EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(attributes->'network_interfaces', '[]'::jsonb)) iface
              WHERE LOWER(
                regexp_replace(
                  COALESCE(iface->>'mac_address', iface->>'mac'),
                  '[^0-9A-Fa-f]',
                  '',
                  'g'
                )
              ) = ?
            )
          `,
          [value]
        );
      })
      .limit(1)
      .first();

    return match?.asset_id ?? null;
  }
};

/**
 * Duplicate detector capable of exact and fuzzy matching against existing assets.
 */
export class DuplicateDetector {
  private readonly tenantId: string;
  private readonly strategy: DuplicateDetectionStrategy;

  constructor(tenantId: string, strategy: DuplicateDetectionStrategy) {
    this.tenantId = tenantId;
    this.strategy = strategy;
  }

  async check(record: ParsedRecord): Promise<DuplicateCheckResult> {
    const knex = await getConnection(this.tenantId);

    const exactFields = this.strategy.exactFields ?? [];
    for (const field of exactFields) {
      const fieldKey = field.toLowerCase();
      const candidateValue = this.getFieldValue(record, fieldKey);
      const normalizedValue = this.normalizeExactValue(fieldKey, candidateValue);
      if (!normalizedValue) {
        continue;
      }

      const resolver = exactResolvers[fieldKey];
      if (!resolver) {
        continue;
      }

      const assetId = await resolver(knex, this.tenantId, normalizedValue);
      if (assetId) {
        return {
          isDuplicate: true,
          matchType: fieldKey,
          matchedAssetId: assetId,
          confidence: 1
        };
      }
    }

    const fuzzyResult = await this.runFuzzyDetection(knex, record);
    if (fuzzyResult) {
      return fuzzyResult;
    }

    return { isDuplicate: false };
  }

  private getFieldValue(record: ParsedRecord, field: string): unknown {
    const direct =
      (record.normalized?.[field] ?? record.raw[field]) ??
      (record.normalized?.[field.toLowerCase()] ?? record.raw[field.toLowerCase()]);
    return direct;
  }

  private normalizeExactValue(field: string, value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      if (field === 'mac_address') {
        const cleaned = trimmed.replace(/[^0-9a-f]/gi, '').toLowerCase();
        return cleaned.length === 12 ? cleaned : null;
        // Normalized MAC stored as twelve hex characters without delimiters
      }

      return trimmed;
    }

    if (typeof value === 'number' && !Number.isNaN(value)) {
      return String(value);
    }

    return null;
  }

  private normalizeFuzzyValue(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    return null;
  }

  private async runFuzzyDetection(knex: Knex, record: ParsedRecord): Promise<DuplicateCheckResult | null> {
    if (!this.strategy.fuzzyFields || this.strategy.fuzzyFields.length === 0) {
      return null;
    }

    const threshold = this.strategy.fuzzyThreshold ?? DEFAULT_FUZZY_THRESHOLD;
    for (const field of this.strategy.fuzzyFields) {
      const fieldKey = field.toLowerCase();
      const rawValue = this.getFieldValue(record, fieldKey);
      const candidateValue = this.normalizeFuzzyValue(rawValue);
      if (!candidateValue) {
        continue;
      }

      const candidates = await this.fetchFuzzyCandidates(knex, fieldKey, candidateValue);
      if (candidates.length === 0) {
        continue;
      }

      const matches = candidates
        .map((candidate) => {
          const similarity = this.computeSimilarity(candidateValue, candidate.name ?? '');
          return {
            asset_id: candidate.asset_id,
            name: candidate.name ?? '',
            similarity
          };
        })
        .filter((candidate) => candidate.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity);

      if (matches.length === 0) {
        continue;
      }

      const bestMatch = matches[0];
      return {
        isDuplicate: true,
        matchType: `fuzzy:${fieldKey}`,
        matchedAssetId: bestMatch.asset_id,
        confidence: Number(bestMatch.similarity.toFixed(3)),
        details: {
          field: fieldKey,
          value: candidateValue,
          matches: this.strategy.allowMultipleMatches ? matches : [bestMatch]
        }
      };
    }

    return null;
  }

  private async fetchFuzzyCandidates(
    knex: Knex,
    field: string,
    value: string
  ): Promise<Array<{ asset_id: string; name: string | null }>> {
    const normalized = value.toLowerCase();
    const column = field === 'hostname' ? 'name' : field;

    if (column !== 'name') {
      return [];
    }

    const prefixLength = Math.min(3, Math.max(normalized.length >= 3 ? 3 : normalized.length, 1));
    const prefix = normalized.slice(0, prefixLength);

    const query = knex<{ asset_id: string; name: string | null }>('assets')
      .select('asset_id', 'name')
      .where('tenant', this.tenantId)
      .whereNotNull(column)
      .limit(MAX_FUZZY_CANDIDATES);

    if (prefix) {
      query.andWhereRaw(`LEFT(LOWER(${column}), ?) = ?`, [prefixLength, prefix]);
    }

    return await query;
  }

  private computeSimilarity(a: string, b: string): number {
    const valueA = a.toLowerCase();
    const valueB = b.toLowerCase();

    if (valueA === valueB) {
      return 1;
    }

    const distance = this.levenshteinDistance(valueA, valueB);
    const maxLength = Math.max(valueA.length, valueB.length);
    if (maxLength === 0) {
      return 0;
    }

    const similarity = 1 - distance / maxLength;
    return similarity < 0 ? 0 : similarity;
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];
    const aLen = a.length;
    const bLen = b.length;

    for (let i = 0; i <= bLen; i += 1) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= aLen; j += 1) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= bLen; i += 1) {
      for (let j = 1; j <= aLen; j += 1) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j] + 1, // deletion
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j - 1] + 1 // substitution
          );
        }
      }
    }

    return matrix[bLen][aLen];
  }
}
