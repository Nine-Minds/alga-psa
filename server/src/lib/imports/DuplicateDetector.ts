import { getConnection } from '@/lib/db/db';
import type { DuplicateCheckResult, DuplicateDetectionStrategy, ParsedRecord } from '@/types/imports.types';

interface FieldResolverConfig {
  table: string;
  column: string;
  caseInsensitive?: boolean;
}

const FIELD_RESOLVERS: Record<string, FieldResolverConfig> = {
  serial_number: {
    table: 'assets',
    column: 'serial_number'
  },
  asset_tag: {
    table: 'assets',
    column: 'asset_tag'
  },
  hostname: {
    table: 'assets',
    column: 'name',
    caseInsensitive: true
  }
};

/**
 * Lightweight duplicate detection with support for exact matches on key fields.
 * Fuzzy matching will be expanded in later phases.
 */
export class DuplicateDetector {
  constructor(
    private readonly tenantId: string,
    private readonly strategy: DuplicateDetectionStrategy
  ) {}

  async check(record: ParsedRecord): Promise<DuplicateCheckResult> {
    const knex = await getConnection(this.tenantId);

    for (const field of this.strategy.exactFields) {
      const resolver = FIELD_RESOLVERS[field.toLowerCase()];
      if (!resolver) {
        continue;
      }

      const value =
        (record.normalized?.[field] ?? record.raw[field]) ??
        (record.normalized?.[field.toLowerCase()] ?? record.raw[field.toLowerCase()]);

      if (value === undefined || value === null || value === '') {
        continue;
      }

      const normalizedValue =
        typeof value === 'string' ? value.trim() : value;

      if (normalizedValue === '') {
        continue;
      }

      const query = knex(resolver.table)
        .select('asset_id')
        .where({ tenant: this.tenantId })
        .whereNotNull(resolver.column)
        .limit(1);

      if (resolver.caseInsensitive) {
        query.andWhereRaw(`LOWER(${resolver.column}) = LOWER(?)`, [normalizedValue]);
      } else {
        query.andWhere(resolver.column, normalizedValue);
      }

      const match = await query.first();
      if (match) {
        return {
          isDuplicate: true,
          matchType: field,
          matchedAssetId: match.asset_id,
          confidence: 1
        };
      }
    }

    return {
      isDuplicate: false
    };
  }
}
